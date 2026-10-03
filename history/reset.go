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
	// ErrNotDiverged is returned when there is nothing to reset: the project
	// has no remote, or a sync brought it back in step.
	ErrNotDiverged = errors.New("the project has not diverged from the remote")
	// ErrStateChanged is returned when either side moved after the check the
	// caller confirmed, so the answer it was shown is not about this state.
	ErrStateChanged = errors.New("the project changed since it was checked")
	// ErrResetRefused is returned when this copy could not be moved without
	// losing something no commit holds. Nothing was reset.
	ErrResetRefused = errors.New("the reset was refused")
)

const (
	// backupPrefix names the branches a reset leaves behind.
	backupPrefix = "scrawl-backup/"
	backupStamp  = "20060102-150405"

	resetMessage = "record what was on disk before the reset"

	// blockedShown is how many paths a refusal names before it stops.
	blockedShown = 5
)

// Divergence is what a reset to the remote would do to this copy.
type Divergence struct {
	// Head and Remote are the two commits that were compared. A reset names
	// them back, so it acts on the state the caller was shown or not at all.
	Head   string
	Remote string
	// Clean means a trial merge found nothing here the remote lacks. It is
	// false whenever that could not be proved, a conflict included.
	Clean bool
	// Lost lists what the remote lacks, as far as the store would serve it.
	// It can be empty while Clean is false: the paths are hidden, or the trial
	// merge failed.
	Lost Unsynced
}

// ResetOp is one confirmed reset.
type ResetOp struct {
	Actor  string
	Head   string
	Remote string
	// PushBackup sends the backup branch to the remote before anything is
	// reset. It is a choice and never a default of this package: a force-push
	// can be how a secret was removed, and a backup would bring it back.
	PushBackup bool
}

// ResetResult says where the state this copy had went.
type ResetResult struct {
	Backup       string // branch that keeps it, empty when nothing was lost
	BackupPushed bool
}

// CheckDivergence syncs once and, if the project is still diverged, measures
// what a reset would lose. It holds the lock a save holds, so the two commits
// and the answer about them belong to one state.
func (s *Service) CheckDivergence(ctx context.Context) (Divergence, error) {
	if s == nil {
		return Divergence{}, ErrDisabled
	}
	if s.cfg.Remote == nil {
		return Divergence{}, fmt.Errorf("history: %w", ErrNotDiverged)
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.divergedLocked(ctx); err != nil {
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

// ResetToRemote moves this copy to the remote's commit. What only this copy
// held stays reachable from a backup branch, and nothing outside a commit is
// overwritten: the reset is refused instead.
func (s *Service) ResetToRemote(ctx context.Context, op ResetOp) (ResetResult, error) {
	if s == nil {
		return ResetResult{}, ErrDisabled
	}
	if s.cfg.Remote == nil {
		return ResetResult{}, fmt.Errorf("history: %w", ErrNotDiverged)
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.divergedLocked(ctx); err != nil {
		return ResetResult{}, err
	}
	head, remote, err := s.tips(ctx)
	if err != nil {
		return ResetResult{}, fmt.Errorf("history: %w", err)
	}
	if head != op.Head || remote != op.Remote {
		return ResetResult{}, fmt.Errorf("history: %w", ErrStateChanged)
	}
	if head, err = s.snapshotLocked(ctx, op.Actor, head); err != nil {
		return ResetResult{}, err
	}

	res := ResetResult{}
	// a trial merge that failed proves nothing, so it keeps a backup too
	if lost, mErr := s.trialMerge(ctx, head, remote); mErr != nil || !lost.clean() {
		if res, err = s.backupLocked(ctx, head, op.PushBackup); err != nil {
			return res, err
		}
	}
	if moveErr := s.moveLocked(ctx, head, remote); moveErr != nil {
		return res, moveErr
	}

	next := SyncState{}
	s.measure(ctx, &next)
	s.publish(next)
	log.Printf("[INFO] %s: reset to %s by %s, was %s, backup %q", s.tag(), remote, sanitizeActor(op.Actor), head, res.Backup)
	return res, nil
}

// divergedLocked runs one whole sync and answers nil only when it ended
// diverged. Going through Sync is what makes the check fresh and what
// republishes the state when the answer is no.
//
// The stage is asked as well as the flag: a fetch that failed carries the flag
// over from the attempt before, and the remote it would reset to is a stale one.
func (s *Service) divergedLocked(ctx context.Context) error {
	err := s.syncLocked(ctx)
	state := s.SyncState()
	switch {
	case err == nil:
		return fmt.Errorf("history: %w", ErrNotDiverged)
	case !state.Diverged, !strings.HasPrefix(state.Error, mergeStage+":"):
		return err
	}
	return nil
}

// tips resolves both sides to commits once. Everything after works on these
// and never on a name, which a path in the worktree could be read as.
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

// snapshotLocked commits what is on disk, so a backup holds it, and returns
// the commit this copy is on afterwards. A pull-only clone never commits, and
// there the reset refuses instead of overwriting what it could not record.
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
	out, err := s.run(ctx, command{args: []string{"rev-parse", "--verify", "HEAD^{commit}"}})
	if err != nil {
		return "", fmt.Errorf("history: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

// lostPaths is what a trial merge found on this side only.
type lostPaths struct {
	paths      []string
	conflicted bool
}

// clean is asked of the conflict flag too, not of the paths alone: a file
// deleted here and changed there merges to the remote's version, so the tree
// shows no difference while the deletion is exactly what a reset loses.
func (l lostPaths) clean() bool { return !l.conflicted && len(l.paths) == 0 }

// trialMerge merges this copy into the remote without touching the worktree or
// the index. Where the result differs from the remote is what this copy holds
// and the remote does not, which a commit count cannot say: after a rebase or
// a squash every old commit still counts as ahead with its content upstream.
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
	// the tree first, then every conflicted path
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

// backupLocked keeps the commit this copy is on under a branch of its own. The
// push runs before anything is reset: a backup the caller asked to have on the
// remote and that never got there is a reason not to reset at all.
func (s *Service) backupLocked(ctx context.Context, head string, push bool) (ResetResult, error) {
	res := ResetResult{Backup: backupPrefix + time.Now().UTC().Format(backupStamp) + "-" + head[:7]}
	ref := "refs/heads/" + res.Backup
	if _, err := s.run(ctx, command{args: []string{"update-ref", ref, head}}); err != nil {
		return ResetResult{}, fmt.Errorf("history: keep a backup: %w", err)
	}
	if !push || s.PullOnly() {
		return res, nil
	}
	if _, err := s.run(ctx, command{
		args:    []string{"push", remoteName, ref + ":" + ref},
		network: true,
		timeout: s.initTimeout(),
	}); err != nil {
		return res, fmt.Errorf("history: push the backup %s: %w", res.Backup, err)
	}
	res.BackupPushed = true
	return res, nil
}

// moveLocked puts the branch and the worktree on the remote's commit.
func (s *Service) moveLocked(ctx context.Context, head, remote string) error {
	if err := s.inTheWay(ctx, head, remote); err != nil {
		return err
	}
	// --keep and not --hard: it refuses when a change no commit holds would be
	// overwritten, and leaves every other one where it is
	if _, err := s.run(ctx, command{
		args:    []string{"reset", "--quiet", "--keep", remote, "--"},
		timeout: s.initTimeout(),
	}); err != nil {
		return fmt.Errorf("%w: %w", ErrResetRefused, err)
	}
	return nil
}

// inTheWay refuses a reset that would write over a file git does not track.
// git refuses that itself, except for an ignored file, which it replaces
// without a word - and the store serves files a .gitignore in the notes names.
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

// untrackedAt names what on disk a file the remote adds would replace: the
// path itself, or a parent that is a file where the remote needs a directory.
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
