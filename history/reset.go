package history

import (
	"context"
	"errors"
	"fmt"
	"log"
	"path"
	"slices"
	"strings"
	"time"
)

var (
	ErrNotDiverged  = errors.New("the space has not diverged from the remote")
	ErrStateChanged = errors.New("the space changed since it was checked")
	ErrResetRefused = errors.New("the reset was refused")
)

const (
	backupPrefix = "scrawl-backup/"
	backupStamp  = "20060102-150405"

	resetMessage = "record what was on disk before the reset"

	blockedShown = 5
)

type Divergence struct {
	Head   string
	Remote string
	Clean  bool
	Lost   Unsynced
}

type ResetOp struct {
	Actor      string
	Head       string
	Remote     string
	PushBackup bool
}

type ResetResult struct {
	Backup       string
	BackupPushed bool
}

func (s *Service) CheckDivergence(ctx context.Context) (Divergence, error) {
	if s == nil {
		return Divergence{}, ErrDisabled
	}
	if s.cfg.Remote == nil {
		return Divergence{}, fmt.Errorf("history: %w", ErrNotDiverged)
	}
	if err := s.lockNet(ctx); err != nil {
		return Divergence{}, err
	}
	defer s.unlockNet()

	if err := s.divergedNet(ctx); err != nil {
		return Divergence{}, err
	}
	head, remote, err := s.tips(ctx)
	if err != nil {
		return Divergence{}, fmt.Errorf("history: %w", err)
	}
	res := Divergence{Head: head, Remote: remote}
	lost, err := s.trialMerge(ctx, head, remote)
	if err != nil {
		log.Printf("[WARN] %s: cannot tell what a reset would lose: %v", s.tag(), err)
		return res, nil
	}
	res.Clean = lost.clean()
	res.Lost = s.visibleCapped(lost.paths)
	return res, nil
}

func (s *Service) ResetToRemote(ctx context.Context, op ResetOp) (ResetResult, error) {
	if s == nil {
		return ResetResult{}, ErrDisabled
	}
	if s.cfg.Remote == nil {
		return ResetResult{}, fmt.Errorf("history: %w", ErrNotDiverged)
	}
	if err := s.lockNet(ctx); err != nil {
		return ResetResult{}, err
	}
	defer s.unlockNet()

	if err := s.divergedNet(ctx); err != nil {
		return ResetResult{}, err
	}
	plan, err := s.prepareReset(ctx, op)
	if err != nil {
		return plan.res, err
	}
	if plan.res.Backup != "" && op.PushBackup && s.pushable() {
		if pErr := s.pushBackupNet(ctx, plan.res.Backup); pErr != nil {
			return plan.res, pErr
		}
		plan.res.BackupPushed = true
	}
	return plan.res, s.finishReset(ctx, op.Actor, plan)
}

type resetPlan struct {
	head   string
	remote string
	res    ResetResult
}

func (s *Service) prepareReset(ctx context.Context, op ResetOp) (resetPlan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	head, remote, err := s.tips(ctx)
	if err != nil {
		return resetPlan{}, fmt.Errorf("history: %w", err)
	}
	if head != op.Head || remote != op.Remote {
		return resetPlan{}, fmt.Errorf("history: %w", ErrStateChanged)
	}
	if head, err = s.snapshotLocked(ctx, op.Actor, head); err != nil {
		return resetPlan{}, err
	}
	plan := resetPlan{head: head, remote: remote}
	if lost, mErr := s.trialMerge(ctx, head, remote); mErr != nil || !lost.clean() {
		plan.res, err = s.backupLocked(ctx, head)
	}
	return plan, err
}

func (s *Service) finishReset(ctx context.Context, actor string, plan resetPlan) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now, err := s.headCommit(ctx)
	if err != nil {
		return err
	}
	if now != plan.head {
		log.Printf("[WARN] %s: the reset stopped, a save came in while it ran, backup %q", s.tag(), plan.res.Backup)
		return fmt.Errorf("history: %w", ErrStateChanged)
	}
	if moveErr := s.moveLocked(ctx, plan.head, plan.remote); moveErr != nil {
		return moveErr
	}

	next := SyncState{}
	s.measureLocked(ctx, &next)
	s.publish(next)
	log.Printf("[INFO] %s: reset to %s by %s, was %s, backup %q", s.tag(), plan.remote, sanitizeActor(actor), plan.head, plan.res.Backup)
	return nil
}

func (s *Service) divergedNet(ctx context.Context) error {
	err := s.syncNet(ctx)
	state := s.SyncState()
	switch {
	case err == nil:
		return fmt.Errorf("history: %w", ErrNotDiverged)
	case !state.Diverged, !strings.HasPrefix(state.Error, mergeStage+":"):
		return err
	}
	return nil
}

func (s *Service) tips(ctx context.Context) (head, remote string, err error) {
	tracking := "refs/remotes/" + remoteName + "/" + s.cfg.Remote.Branch
	out, err := s.run(ctx, command{args: []string{"rev-parse", "HEAD^{commit}", tracking + "^{commit}"}})
	if err != nil {
		return "", "", err
	}
	revs := strings.Fields(string(out))
	if len(revs) != 2 {
		return "", "", fmt.Errorf("git rev-parse answered %q for two revisions", out)
	}
	return revs[0], revs[1], nil
}

func (s *Service) snapshotLocked(ctx context.Context, actor, head string) (string, error) {
	if s.PullOnly() {
		return head, nil
	}
	committed, err := s.reconcileLocked(ctx, actor, resetMessage)
	if err != nil {
		return "", fmt.Errorf("%w: %w", ErrResetRefused, err)
	}
	if !committed {
		return head, nil
	}
	return s.headCommit(ctx)
}

func (s *Service) headCommit(ctx context.Context) (string, error) {
	out, err := s.run(ctx, command{args: []string{"rev-parse", "--verify", "HEAD^{commit}"}})
	if err != nil {
		return "", fmt.Errorf("history: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

type lostPaths struct {
	paths      []string
	conflicted bool
}

func (l lostPaths) clean() bool { return !l.conflicted && len(l.paths) == 0 }

func (s *Service) trialMerge(ctx context.Context, head, remote string) (lostPaths, error) {
	out, err := s.run(ctx, command{
		args:    []string{"merge-tree", "--write-tree", "--allow-unrelated-histories", "--name-only", "--no-messages", "-z", remote, head},
		exitOne: true,
		limit:   maxListBytes,
		timeout: s.initTimeout(),
	})
	res := lostPaths{conflicted: errors.Is(err, errExitOne)}
	if err != nil && !res.conflicted {
		return lostPaths{}, err
	}
	fields := splitNul(out)
	if len(fields) == 0 {
		return lostPaths{}, errors.New("git merge-tree named no tree")
	}
	out, err = s.run(ctx, command{
		args:    []string{"diff", "--name-only", "--no-renames", "-z", remote, fields[0], "--"},
		limit:   maxListBytes,
		timeout: s.initTimeout(),
	})
	if err != nil {
		return lostPaths{}, err
	}
	res.paths = merge(splitNul(out), fields[1:])
	return res, nil
}

func (s *Service) backupLocked(ctx context.Context, head string) (ResetResult, error) {
	res := ResetResult{Backup: backupPrefix + time.Now().UTC().Format(backupStamp) + "-" + head[:7]}
	if _, err := s.run(ctx, command{args: []string{"update-ref", "refs/heads/" + res.Backup, head}}); err != nil {
		return ResetResult{}, fmt.Errorf("history: keep a backup: %w", err)
	}
	return res, nil
}

func (s *Service) pushBackupNet(ctx context.Context, backup string) error {
	ref := "refs/heads/" + backup
	if _, err := s.run(ctx, command{
		args:    []string{"push", remoteName, ref + ":" + ref},
		network: true,
		timeout: s.initTimeout(),
	}); err != nil {
		return fmt.Errorf("history: push the backup %s: %w", backup, err)
	}
	return nil
}

func (s *Service) moveLocked(ctx context.Context, head, remote string) error {
	if err := s.inTheWay(ctx, head, remote); err != nil {
		return err
	}
	if _, err := s.run(ctx, command{
		args:    []string{"reset", "--quiet", "--keep", remote, "--"},
		timeout: s.initTimeout(),
	}); err != nil {
		return fmt.Errorf("%w: %w", ErrResetRefused, err)
	}
	return nil
}

func (s *Service) inTheWay(ctx context.Context, head, remote string) error {
	out, err := s.run(ctx, command{
		args:    []string{"diff", "--name-only", "--no-renames", "--diff-filter=A", "-z", head, remote, "--"},
		limit:   maxListBytes,
		timeout: s.initTimeout(),
	})
	if err != nil {
		return fmt.Errorf("history: %w", err)
	}
	tracked, err := s.tracked(ctx, s.initTimeout())
	if err != nil {
		return fmt.Errorf("history: %w", err)
	}

	blocked := []string{}
	for _, incoming := range splitNul(out) {
		if at := s.untrackedAt(incoming, tracked); at != "" && !slices.Contains(blocked, at) {
			blocked = append(blocked, at)
		}
	}
	if len(blocked) == 0 {
		return nil
	}
	shown := blocked[:min(len(blocked), blockedShown)]
	return fmt.Errorf("%w: %d untracked paths on disk stand where the remote has files of its own: %s",
		ErrResetRefused, len(blocked), strings.Join(shown, ", "))
}

func (s *Service) untrackedAt(incoming string, tracked map[string]struct{}) string {
	for dir := path.Dir(incoming); dir != "."; dir = path.Dir(dir) {
		if _, ok := tracked[dir]; ok {
			continue
		}
		if fi, err := s.files.Lstat(dir); err == nil && !fi.IsDir() {
			return dir
		}
	}
	if _, ok := tracked[incoming]; ok {
		return ""
	}
	if _, err := s.files.Lstat(incoming); err == nil {
		return incoming
	}
	return ""
}
