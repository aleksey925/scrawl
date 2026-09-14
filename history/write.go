package history

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"slices"
	"time"
)

const (
	defaultMessage   = "update"
	baselineMessage  = "import the existing notes"
	reconcileMessage = "record changes made outside the app"
)

// Op describes the change a Record is about to make.
type Op struct {
	Actor   string // "alex", "token:ci", "external"
	Message string
	Paths   []string // exact store paths the mutation touches
	Strict  bool     // a failed commit is an error for the caller
}

// Record runs the mutation and commits the paths it names, holding one lock
// across both. The lock is the point: with the mutation outside it, a second
// request's commit picks up the first request's write and signs it with the
// wrong actor, and the audit trail says something that never happened.
//
// The mutation reports the paths it touched, because not every caller knows
// them in advance: an upload learns the name only once the store has picked a
// free one, and naming the directory instead would stage everything under it.
// Paths known up front go in Op.Paths and are validated before the mutation
// runs, so one the service could never record refuses the write rather than
// quietly skipping the audit trail.
//
// A failed commit is fatal only when Op.Strict is set, which is what an API
// client gets: an automated agent must not believe it changed a document that
// history never recorded. Otherwise the save stands, the service reports
// Degraded, and the paths are folded into the next successful commit.
//
// An error from the mutation is returned untouched, so the caller can still
// match the store sentinels on it.
func (s *Service) Record(ctx context.Context, op Op, mutate func() ([]string, error)) error {
	if s == nil {
		_, err := mutate()
		return err
	}
	paths, err := s.recordPaths(op.Paths)
	if err != nil {
		return fmt.Errorf("history: record: %w", err)
	}
	op.Message = message(op)

	s.mu.Lock()
	defer s.mu.Unlock()

	touched, mErr := mutate()
	if mErr != nil {
		return mErr
	}
	paths = merge(paths, s.mutatedPaths(touched))
	if len(paths) == 0 && len(s.pending) == 0 {
		return nil
	}
	if err = s.commitLocked(ctx, op.Actor, op.Message, s.withPending(paths), s.timeout()); err != nil {
		return s.recordFailed(op, paths, err)
	}
	clear(s.pending)
	s.degraded.Store(false)
	return nil
}

// Reconcile stages every visible versionable path and commits whatever differs
// from what history holds. It is the baseline import on an empty repository,
// the recovery for a crash between a write and its commit, and how a change
// made outside the app - over SMB, by another tool - reaches history at all.
func (s *Service) Reconcile(ctx context.Context, actor string) error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	paths, err := s.reconcilePaths(ctx)
	if err != nil {
		return fmt.Errorf("history: reconcile: %w", err)
	}
	if len(paths) == 0 {
		return nil
	}
	msg := reconcileMessage
	if !s.hasHead(ctx) {
		msg = baselineMessage
	}
	if err = s.commitLocked(ctx, actor, msg, paths, s.initTimeout()); err != nil {
		return s.recordFailed(Op{Actor: actor, Message: msg, Strict: true}, paths, err)
	}
	clear(s.pending)
	s.degraded.Store(false)
	return nil
}

// recordFailed remembers what was missed and decides whether the caller hears
// about it. Called with the lock held.
func (s *Service) recordFailed(op Op, paths []string, err error) error {
	for _, p := range paths {
		s.pending[p] = struct{}{}
	}
	s.degraded.Store(true)
	if op.Strict {
		return fmt.Errorf("history: record %q: %w", op.Message, err)
	}
	log.Printf("[WARN] history: %q was not recorded and the next commit will fold it in: %v", op.Message, err)
	return nil
}

// commitLocked stages the paths and commits them under the actor. Called with
// the lock held.
func (s *Service) commitLocked(ctx context.Context, actor, msg string, paths []string, timeout time.Duration) error {
	candidates, err := s.stageable(ctx, paths, timeout)
	if err != nil {
		return err
	}
	if len(candidates) == 0 {
		return nil
	}
	if sErr := s.stage(ctx, candidates, timeout); sErr != nil {
		return sErr
	}
	dirty, err := s.staged(ctx, timeout)
	if err != nil {
		return err
	}
	if !dirty {
		return nil
	}
	args := []string{"commit", "--quiet", "--message", msg, "--author", ident(actor)}
	_, err = s.run(ctx, command{args: args, timeout: timeout})
	return err
}

// stage records the exact paths, and only those. "-A" scoped by a pathspec is
// what records a deletion; it is bare "-A" that would swallow the worktree.
// The paths go in NUL-delimited on stdin, so neither argv limits nor quoting
// have any say in what gets staged.
func (s *Service) stage(ctx context.Context, paths []string, timeout time.Duration) error {
	var stdin bytes.Buffer
	for _, p := range paths {
		stdin.WriteString(p)
		stdin.WriteByte(0)
	}
	args := []string{"add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"}
	_, err := s.run(ctx, command{args: args, stdin: stdin.Bytes(), timeout: timeout})
	return err
}

// stageable drops what git would refuse. A pathspec that matches neither the
// worktree nor the index is a fatal error for the whole call, and a delete of a
// file history never held looks exactly like that.
func (s *Service) stageable(ctx context.Context, paths []string, timeout time.Duration) ([]string, error) {
	res, missing := make([]string, 0, len(paths)), make([]string, 0)
	for _, p := range paths {
		if s.exists(p) {
			res = append(res, p)
			continue
		}
		missing = append(missing, p)
	}
	if len(missing) == 0 {
		return res, nil
	}
	tracked, err := s.tracked(ctx, timeout)
	if err != nil {
		return nil, err
	}
	for _, p := range missing {
		if _, ok := tracked[p]; ok {
			res = append(res, p)
		}
	}
	slices.Sort(res)
	return slices.Compact(res), nil
}

// tracked reads the whole index. Asking about single paths instead would put
// them in argv, and a reconcile of a large corpus does not fit there.
func (s *Service) tracked(ctx context.Context, timeout time.Duration) (map[string]struct{}, error) {
	out, err := s.run(ctx, command{args: []string{"ls-files", "-z"}, timeout: timeout, limit: maxListBytes})
	if err != nil {
		return nil, err
	}
	res := map[string]struct{}{}
	for _, p := range splitNul(out) {
		res[p] = struct{}{}
	}
	return res, nil
}

// recordPaths validates what an operation named and keeps the versionable ones.
// It runs before the mutation, so a path the service could never record stops
// the write instead of quietly skipping the audit trail.
func (s *Service) recordPaths(paths []string) ([]string, error) {
	res := make([]string, 0, len(paths))
	for _, p := range paths {
		cleaned, err := cleanPath(p)
		if err != nil {
			return nil, err
		}
		if s.versioned(cleaned) {
			res = append(res, cleaned)
		}
	}
	slices.Sort(res)
	return slices.Compact(res), nil
}

// mutatedPaths keeps the versionable paths a mutation reported for itself. One
// it cannot clean is dropped instead of failing the caller: the write has
// already happened, so refusing now would report a change that did land, and
// the next Reconcile stages the path anyway.
func (s *Service) mutatedPaths(paths []string) []string {
	res := make([]string, 0, len(paths))
	for _, p := range paths {
		cleaned, err := cleanPath(p)
		if err != nil {
			log.Printf("[WARN] history: skipping %q, which the mutation reported: %v", p, err)
			continue
		}
		if s.versioned(cleaned) {
			res = append(res, cleaned)
		}
	}
	return res
}

// reconcilePaths is everything worth staging: what the store still shows, plus
// what history holds and the store no longer has. Called with the lock held.
func (s *Service) reconcilePaths(ctx context.Context) ([]string, error) {
	visible, err := s.cfg.Files()
	if err != nil {
		return nil, fmt.Errorf("list the notes: %w", err)
	}
	res := make([]string, 0, len(visible))
	seen := make(map[string]struct{}, len(visible))
	add := func(p string) {
		if _, dup := seen[p]; dup {
			return
		}
		seen[p] = struct{}{}
		res = append(res, p)
	}

	for _, p := range visible {
		cleaned, cErr := cleanPath(p)
		if cErr != nil {
			// one odd entry must not stop the import of everything else
			log.Printf("[WARN] history: skipping %q: %v", p, cErr)
			continue
		}
		if s.versioned(cleaned) {
			add(cleaned)
		}
	}

	tracked, err := s.tracked(ctx, s.initTimeout())
	if err != nil {
		return nil, err
	}
	for p := range tracked {
		// a tracked path the store no longer shows is staged only when it is
		// really gone: one that merely became invisible stays as history left
		// it, rather than having its content recorded behind the store's back
		if _, ok := seen[p]; !ok && !s.exists(p) {
			add(p)
		}
	}
	for p := range s.pending {
		add(p)
	}

	slices.Sort(res)
	return res, nil
}

// withPending folds in the paths of an earlier failed commit. Called with the
// lock held.
func (s *Service) withPending(paths []string) []string {
	if len(s.pending) == 0 {
		return paths
	}
	res := slices.Clone(paths)
	for p := range s.pending {
		res = append(res, p)
	}
	slices.Sort(res)
	return slices.Compact(res)
}

// merge joins two path sets into one sorted set without duplicates.
func merge(known, touched []string) []string {
	if len(touched) == 0 {
		return known
	}
	res := slices.Concat(known, touched)
	slices.Sort(res)
	return slices.Compact(res)
}

func message(op Op) string {
	if op.Message == "" {
		return defaultMessage
	}
	return op.Message
}

func splitNul(out []byte) []string {
	res := []string{}
	for field := range bytes.SplitSeq(out, []byte{0}) {
		if len(field) > 0 {
			res = append(res, string(field))
		}
	}
	return res
}
