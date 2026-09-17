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

// ErrNotPublished marks a change that was written and recorded but never
// reached the remote. Only a strict caller, which is an API client, is told
// about it: an agent must never get a 200 for a change the remote missed.
var ErrNotPublished = errors.New("not pushed to the remote")

// cloneTimeout bounds the first fetch, which is the only git call that reads a
// whole repository over the network.
const cloneTimeout = 30 * time.Minute

// remoteName is the only remote this package ever speaks to.
const remoteName = "origin"

// Remote points a service at a git remote. Token is the resolved header value,
// never a path and never the name of a variable: the configuration spellings
// stop in main, which resolves whichever one was given once, before the
// redaction list is fixed.
type Remote struct {
	URL       string
	Branch    string
	Token     string
	PullEvery time.Duration // 0 disables the background pull
	// PullOnly is the effective read-only mode of a remote project seen from
	// this side: fetch and merge, never reconcile, never publish, never probe.
	// A project that cannot push has nothing to gain from trying and everything
	// to lose from reporting itself unpublished for changes nobody made.
	PullOnly bool
}

// StagingDir is where the first fetch lands before it becomes the project, and
// the only thing an interrupted clone leaves behind. A caller deciding whether a
// directory still has to be cloned into ignores it: it is ours, it is never part
// of the notes, and Clone clears whatever an earlier attempt left.
const StagingDir = ".scrawl-clone"

// Clone makes the first fetch of a remote into dir. It runs when there is no
// directory yet and therefore no service, which is why it goes through runGit
// with the same hardening rather than through a method.
//
// The clone lands in a staging directory **inside** dir and its entries are
// moved up one level, so an interrupted one leaves that directory behind and
// nothing else to reason about: the next start sees it, clears what the attempt
// had already moved, and clones again.
//
// Inside and not beside, which the first version had wrong. dir is what an
// operator mounts, so its parent is the container's own filesystem - read-only
// in any hardened deployment, and `/` for the documented default - and a mount
// point can be neither removed nor renamed over. Staging inside it also makes
// every move a rename on one filesystem, which a sibling never guaranteed.
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
	// full depth, not shallow: a shallow clone breaks Log and complicates
	// pushing, and the corpus is text
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

// clearInterrupted empties dir when an earlier clone died in the middle of one.
// The staging directory is the proof that it did, and everything beside it is
// then what that attempt had already moved: dir was empty when it started, so
// there is nothing of anybody's to lose.
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

// moveInto lifts the finished clone one level up, into the directory the
// project is served from. Both ends sit on the same filesystem, so every entry
// moves with a rename and no copy can half-finish.
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

// checkRemote verifies an existing clone rather than repairing one. Silently
// re-cloning or repointing would throw away commits that were never pushed.
func (s *Service) checkRemote(ctx context.Context) error {
	rm := s.cfg.Remote
	out, err := s.run(ctx, command{args: []string{"remote", "get-url", remoteName}})
	if err != nil {
		return fmt.Errorf("%s has no %s remote, it is not the clone this project configured: %w",
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

// Sync brings the clone level with the remote and pushes what is local. It
// takes the same lock Record holds, which is the point: a merge rewrites the
// worktree, so it must not interleave with a save.
//
// Three stages, each with one rule. Sync returns the first error it hit, and
// the error is cleared only by a run in which every stage it performed
// succeeded - so a pull-only project clears it after the merge, and a writable
// one only after the push as well.
//
// Whatever the stage, the whole state is published once, when the attempt ends,
// so a reader can never observe an error paired with the paths of a different
// attempt.
func (s *Service) Sync(ctx context.Context) error {
	if s == nil || s.cfg.Remote == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.syncLocked(ctx)
}

// syncLocked is Sync with the lock already held.
func (s *Service) syncLocked(ctx context.Context) error {
	rm := s.cfg.Remote
	tracking := remoteName + "/" + rm.Branch
	next := s.SyncState()

	if _, err := s.run(ctx, command{
		args:    []string{"fetch", "--prune", remoteName, rm.Branch},
		network: true,
		timeout: s.initTimeout(),
	}); err != nil {
		// origin/<branch> did not move, so a measurement would answer what it
		// answered before: carry the rest of the state over untouched
		return s.syncFailed(next, "fetch", err)
	}

	if _, err := s.run(ctx, command{
		args:    []string{"merge", "--ff-only", tracking},
		timeout: s.initTimeout(),
	}); err != nil {
		s.measure(ctx, &next)
		return s.syncFailed(next, "merge", fmt.Errorf(
			"the branch has diverged from %s; in %s run: git pull --rebase && git push", tracking, s.root))
	}

	if rm.PullOnly {
		next.Error = ""
		s.publish(next)
		return nil
	}
	return s.publishLocked(ctx)
}

// publishLocked pushes what the clone holds. It is never gated on Unpublished:
// that state is reported, never a retry gate, because gating would mean a
// commit that never leaves the container whenever the measurement is wrong or
// has not run yet. An already up-to-date push costs one round trip.
func (s *Service) publishLocked(ctx context.Context) error {
	rm := s.cfg.Remote
	if rm == nil || rm.PullOnly {
		return nil
	}
	next := s.SyncState()
	_, err := s.run(ctx, command{
		args:    []string{"push", remoteName, "HEAD:refs/heads/" + rm.Branch},
		network: true,
		timeout: s.initTimeout(),
	})
	s.measure(ctx, &next)
	if err != nil {
		return s.syncFailed(next, "push", err)
	}
	next.Error = ""
	s.publish(next)
	return nil
}

// measure asks how far ahead of the last fetched remote ref this clone is, and
// which paths that covers. It is a measurement and never a remembered flag: a
// flag only set by a failed push would be false in a fresh process whose clone
// is already ahead, and on a diverged branch after a restart the ff-only merge
// fails before any push is attempted, so nothing would ever set it.
//
// A measurement that fails leaves the state as it was and says so in the log.
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

// unsyncedPaths lists what this copy changed and the remote does not have. It
// runs only when the count above is non-zero, so a healthy project pays for one
// rev-list and nothing else.
//
// Three dots and not two. With --ff-only as the whole merge policy the two
// spellings normally agree, and they differ in the case that matters most: on a
// diverged branch a two-dot diff would also list every path the remote changed,
// and those files would wear a badge although nobody here touched them. Three
// dots diffs from the merge base, which is what this copy changed since it
// forked.
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

	// the filter runs before the cap, so the cap counts what a reader could
	// actually see: 201 hidden paths must not spend it and suppress the one
	// visible note that really did change
	res := make([]string, 0, unsyncedCap)
	for _, p := range splitNul(out) {
		if s.cfg.Visible != nil && !s.cfg.Visible(p) {
			continue
		}
		if len(res) == unsyncedCap {
			// past the cap the reader's question is no longer "which note" but
			// "the whole corpus", and a partial list would read as "these files
			// and no others"
			return Unsynced{Many: true}
		}
		res = append(res, p)
	}
	return Unsynced{Paths: res}
}

// syncFailed publishes a failed stage and logs it once, naming the project.
func (s *Service) syncFailed(next SyncState, stage string, err error) error {
	next.Error = stage + ": " + err.Error()
	s.publish(next)
	log.Printf("[WARN] %s: %s", s.tag(), next.Error)
	return fmt.Errorf("history: sync %s: %w", stage, err)
}

func (s *Service) publish(next SyncState) { s.sync.Store(&next) }

// SyncState is the whole remote state of one project, read in a single load so
// that an error can never be paired with the paths of a different attempt.
func (s *Service) SyncState() SyncState {
	if s == nil {
		return SyncState{}
	}
	if state := s.sync.Load(); state != nil {
		return *state
	}
	return SyncState{}
}

// Unpublished reports that the clone holds commits the remote does not. It is
// kept apart from the commit state on purpose: a commit that stages nothing
// succeeds and clears Degraded, which would report a healthy history while the
// remote was still behind.
func (s *Service) Unpublished() bool { return s.SyncState().Unpublished }

// SyncError is what the last conversation with the remote failed with, already
// redacted: it is shown in the UI, which lgr.Secret never touches.
func (s *Service) SyncError() string { return s.SyncState().Error }

// Remote reports whether this service tracks one.
func (s *Service) Remote() bool { return s != nil && s.cfg.Remote != nil }

// PullOnly reports that this clone never writes to git: it fetches and
// fast-forwards, and it neither reconciles nor publishes. It is the one home of
// that rule, so a caller asks instead of deriving it from the read-only mode a
// second time.
func (s *Service) PullOnly() bool { return s.Remote() && s.cfg.Remote.PullOnly }

// ProbeWritable pushes nothing and reports whether a push would be refused. It
// is a loud warning and never a mode: a probe that silently flipped a project
// to read-only would be a setting nobody configured, changing with the network.
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

// unsyncedCap is how many paths a reader is shown before the list stops being
// worth drawing. Past it the question has changed from "which note" to "the
// whole corpus", which a per-file badge cannot answer.
const unsyncedCap = 200

// Unsynced lists the paths this copy has committed and the remote does not
// have. Paths is empty and Many is true above the cap: a partial list would
// read as "these files and no others", which is worse than saying nothing
// about files at all.
type Unsynced struct {
	Paths []string
	Many  bool
}

// SyncState is the whole remote state of one project as one attempt left it.
// The three values are published together, so a reader never observes an error
// from one attempt beside the paths of another.
type SyncState struct {
	// Unpublished is the commit count, and Unsynced the paths behind it. They
	// are two measurements and not one: a commit that changes nothing net is
	// ahead by a commit and empty by a diff.
	Unpublished bool
	Error       string // already redacted
	Unsynced    Unsynced
}

// redactURL strips a userinfo a url may carry. Validation refuses one at
// startup, so this covers a url that reached us some other way.
func redactURL(raw string) string {
	at := strings.LastIndex(raw, "@")
	scheme := strings.Index(raw, "://")
	if at < 0 || scheme < 0 || at < scheme {
		return raw
	}
	return raw[:scheme+3] + redacted + raw[at:]
}
