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

type Op struct {
	Actor   string
	Message string
	Paths   []string
	Strict  bool
}

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
	return s.publishFailed(op, s.publishLocked(ctx, s.SyncState()))
}

func (s *Service) publishFailed(op Op, err error) error {
	if err == nil {
		return nil
	}
	if op.Strict {
		return fmt.Errorf("history: %w: %w", ErrNotPublished, err)
	}
	return nil
}

func (s *Service) Reconcile(ctx context.Context, actor string) error {
	if s == nil || s.PullOnly() {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	msg := reconcileMessage
	if !s.hasHead(ctx) {
		msg = baselineMessage
	}
	committed, err := s.reconcileLocked(ctx, actor, msg)
	if err != nil || !committed {
		return err
	}
	_ = s.publishLocked(ctx, s.SyncState())
	return nil
}

func (s *Service) reconcileLocked(ctx context.Context, actor, msg string) (bool, error) {
	paths, err := s.reconcilePaths(ctx)
	if err != nil {
		return false, fmt.Errorf("history: reconcile: %w", err)
	}
	if len(paths) == 0 {
		return false, nil
	}
	if err = s.commitLocked(ctx, actor, msg, paths, s.initTimeout()); err != nil {
		return false, s.recordFailed(Op{Actor: actor, Message: msg, Strict: true}, paths, err)
	}
	clear(s.pending)
	s.degraded.Store(false)
	return true, nil
}

func (s *Service) recordFailed(op Op, paths []string, err error) error {
	for _, p := range paths {
		s.pending[p] = struct{}{}
	}
	s.degraded.Store(true)
	if op.Strict {
		return fmt.Errorf("history: record %q: %w", op.Message, err)
	}
	log.Printf("[WARN] %s: %q was not recorded and the next commit will fold it in: %v", s.tag(), op.Message, err)
	return nil
}

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

func (s *Service) stage(ctx context.Context, paths []string, timeout time.Duration) error {
	var stdin bytes.Buffer
	for _, p := range paths {
		stdin.WriteString(p)
		stdin.WriteByte(0)
	}
	args := []string{"add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"}
	if s.cfg.TrackAll {
		args = append(args, "-f")
	}
	_, err := s.run(ctx, command{args: args, stdin: stdin.Bytes(), timeout: timeout})
	return err
}

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

func (s *Service) mutatedPaths(paths []string) []string {
	res := make([]string, 0, len(paths))
	for _, p := range paths {
		cleaned, err := cleanPath(p)
		if err != nil {
			log.Printf("[WARN] %s: skipping %q, which the mutation reported: %v", s.tag(), p, err)
			continue
		}
		if s.versioned(cleaned) {
			res = append(res, cleaned)
		}
	}
	return res
}

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
			log.Printf("[WARN] %s: skipping %q: %v", s.tag(), p, cErr)
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
