package history

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

var ErrNotPublished = errors.New("not pushed to the remote")

const cloneTimeout = 30 * time.Minute

const remoteName = "origin"

const mergeStage = "merge"

type Remote struct {
	URL       string
	Branch    string
	Token     string
	PullEvery time.Duration
	PullOnly  bool
}

const StagingDir = ".scrawl-clone"

func Clone(ctx context.Context, dir string, rm Remote) error {
	git, err := exec.LookPath("git")
	if err != nil {
		return fmt.Errorf("history: %w: %w", ErrNoGit, err)
	}
	if err = os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("history: prepare %s: %w", dir, err)
	}
	staging := filepath.Join(dir, StagingDir)
	if cErr := clearInterrupted(dir, staging); cErr != nil {
		return cErr
	}
	defer func() { _ = os.RemoveAll(staging) }()

	target := filepath.Join(staging, "work")
	args := []string{"clone", "--branch", rm.Branch, "--single-branch", "--", rm.URL, target}
	if _, err = runGit(ctx, gitRun{
		git:     git,
		dir:     dir,
		env:     gitEnv(rm.Token),
		base:    hardenedArgs(dir),
		args:    args,
		timeout: cloneTimeout,
		secret:  rm.Token,
	}); err != nil {
		return fmt.Errorf("history: clone %s: %w", redactURL(rm.URL), err)
	}

	if mErr := moveInto(dir, target); mErr != nil {
		return mErr
	}
	log.Printf("[INFO] history: cloned %s into %s", redactURL(rm.URL), dir)
	return nil
}

func clearInterrupted(dir, staging string) error {
	if _, err := os.Stat(staging); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("history: look at %s: %w", staging, err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("history: read %s: %w", dir, err)
	}
	for _, ent := range entries {
		if err = os.RemoveAll(filepath.Join(dir, ent.Name())); err != nil {
			return fmt.Errorf("history: clear what an interrupted clone left in %s: %w", dir, err)
		}
	}
	log.Printf("[WARN] history: %s held an interrupted clone, cloning again", dir)
	return nil
}

func moveInto(dir, work string) error {
	entries, err := os.ReadDir(work)
	if err != nil {
		return fmt.Errorf("history: read the clone in %s: %w", work, err)
	}
	for _, ent := range entries {
		if err = os.Rename(filepath.Join(work, ent.Name()), filepath.Join(dir, ent.Name())); err != nil {
			return fmt.Errorf("history: put the clone in %s: %w", dir, err)
		}
	}
	return nil
}

func (s *Service) checkRemote(ctx context.Context) error {
	rm := s.cfg.Remote
	out, err := s.run(ctx, command{args: []string{"remote", "get-url", remoteName}})
	if err != nil {
		return fmt.Errorf("%s has no %s remote, it is not the clone this space configured: %w",
			s.root, remoteName, err)
	}
	if got := string(bytes.TrimRight(out, "\n")); got != rm.URL {
		return fmt.Errorf("%s tracks %s, not the configured %s", s.root, redactURL(got), redactURL(rm.URL))
	}
	if out, err = s.run(ctx, command{args: []string{"rev-parse", "--abbrev-ref", "HEAD"}}); err != nil {
		return err
	}
	if got := string(bytes.TrimRight(out, "\n")); got != rm.Branch {
		return fmt.Errorf("%s is on branch %s, not the configured %s", s.root, got, rm.Branch)
	}
	return nil
}

func (s *Service) Sync(ctx context.Context) error {
	if s == nil || s.cfg.Remote == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.syncLocked(ctx)
}

func (s *Service) syncLocked(ctx context.Context) error {
	rm := s.cfg.Remote
	tracking := remoteName + "/" + rm.Branch
	next := s.SyncState()

	if _, err := s.run(ctx, command{
		args:    []string{"fetch", "--prune", remoteName, rm.Branch},
		network: true,
		timeout: s.initTimeout(),
	}); err != nil {
		return s.syncFailed(next, "fetch", err)
	}

	if _, err := s.run(ctx, command{
		args:    []string{"merge", "--ff-only", tracking},
		timeout: s.initTimeout(),
	}); err != nil {
		s.measure(ctx, &next)
		if next.Diverged = s.diverged(ctx, tracking); next.Diverged {
			err = fmt.Errorf("the branch has diverged from %s", tracking)
		}
		return s.syncFailed(next, mergeStage, err)
	}

	next.Diverged = false
	if rm.PullOnly {
		next.Error = ""
		s.publish(next)
		return nil
	}
	return s.publishLocked(ctx, next)
}

func (s *Service) diverged(ctx context.Context, tracking string) bool {
	return s.notAncestor(ctx, "HEAD", tracking) && s.notAncestor(ctx, tracking, "HEAD")
}

func (s *Service) notAncestor(ctx context.Context, older, newer string) bool {
	_, err := s.run(ctx, command{args: []string{"merge-base", "--is-ancestor", older, newer}, exitOne: true})
	return errors.Is(err, errExitOne)
}

func (s *Service) publishLocked(ctx context.Context, next SyncState) error {
	rm := s.cfg.Remote
	if rm == nil || rm.PullOnly {
		return nil
	}
	if next.Diverged = next.Diverged && s.diverged(ctx, remoteName+"/"+rm.Branch); next.Diverged {
		s.measure(ctx, &next)
		s.publish(next)
		return errors.New(next.Error)
	}
	_, err := s.run(ctx, command{
		args:    []string{"push", remoteName, "HEAD:refs/heads/" + rm.Branch},
		network: true,
		timeout: s.initTimeout(),
	})
	s.measure(ctx, &next)
	next.Refused = refused(err)
	if err != nil {
		return s.syncFailed(next, "push", err)
	}
	next.Error = ""
	s.publish(next)
	return nil
}

var refusalSigns = []string{
	"could not read Username for",
	"could not read Password for",
	"Authentication failed for",
	"The requested URL returned error: 403",
}

func refused(err error) bool {
	var failed *gitError
	if !errors.As(err, &failed) {
		return false
	}
	for _, sign := range refusalSigns {
		if strings.Contains(failed.stderr, sign) {
			return true
		}
	}
	return false
}

func (s *Service) measure(ctx context.Context, into *SyncState) {
	rm := s.cfg.Remote
	out, err := s.run(ctx, command{
		args: []string{"rev-list", "--count", remoteName + "/" + rm.Branch + "..HEAD"},
	})
	if err != nil {
		log.Printf("[WARN] %s: cannot tell how far ahead of %s this clone is: %v", s.tag(), remoteName, err)
		return
	}
	count, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil {
		log.Printf("[WARN] %s: cannot read the commit count: %v", s.tag(), err)
		return
	}
	if count == 0 {
		into.Unpublished, into.Unsynced = false, Unsynced{}
		return
	}
	into.Unpublished = true
	into.Unsynced = s.unsyncedPaths(ctx)
}

func (s *Service) unsyncedPaths(ctx context.Context) Unsynced {
	rm := s.cfg.Remote
	out, err := s.run(ctx, command{
		args:  []string{"diff", "--name-only", "-z", remoteName + "/" + rm.Branch + "...HEAD"},
		limit: maxListBytes,
	})
	if err != nil {
		log.Printf("[WARN] %s: cannot list what the remote is missing: %v", s.tag(), err)
		return Unsynced{}
	}

	return s.visibleCapped(splitNul(out))
}

func (s *Service) visibleCapped(paths []string) Unsynced {
	res := make([]string, 0, min(len(paths), unsyncedCap))
	for _, p := range paths {
		if s.cfg.Visible != nil && !s.cfg.Visible(p) {
			continue
		}
		if len(res) == unsyncedCap {
			return Unsynced{Many: true}
		}
		res = append(res, p)
	}
	return Unsynced{Paths: res}
}

func (s *Service) syncFailed(next SyncState, stage string, err error) error {
	next.Error = stage + ": " + err.Error()
	s.publish(next)
	log.Printf("[WARN] %s: %s", s.tag(), next.Error)
	return fmt.Errorf("history: sync %s: %w", stage, err)
}

func (s *Service) publish(next SyncState) { s.sync.Store(&next) }

func (s *Service) SyncState() SyncState {
	if s == nil {
		return SyncState{}
	}
	if state := s.sync.Load(); state != nil {
		return *state
	}
	return SyncState{}
}

func (s *Service) Unpublished() bool { return s.SyncState().Unpublished }

func (s *Service) SyncError() string { return s.SyncState().Error }

func (s *Service) Remote() bool { return s != nil && s.cfg.Remote != nil }

func (s *Service) PullOnly() bool { return s.Remote() && s.cfg.Remote.PullOnly }

func (s *Service) ProbeWritable(ctx context.Context) error {
	if s == nil || s.cfg.Remote == nil || s.cfg.Remote.PullOnly {
		return nil
	}
	_, err := s.run(ctx, command{
		args:    []string{"push", "--dry-run", remoteName, "HEAD:refs/heads/" + s.cfg.Remote.Branch},
		network: true,
	})
	return err
}

const unsyncedCap = 200

type Unsynced struct {
	Paths []string
	Many  bool
}

type SyncState struct {
	Unpublished bool
	Error       string
	Unsynced    Unsynced
	Diverged    bool
	Refused     bool
}

func redactURL(raw string) string {
	at := strings.LastIndex(raw, "@")
	scheme := strings.Index(raw, "://")
	if at < 0 || scheme < 0 || at < scheme {
		return raw
	}
	return raw[:scheme+3] + redacted + raw[at:]
}
