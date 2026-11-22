package history

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

const maxConflictExit = 127

var (
	ErrNothingToUndo = errors.New("this version changed no text to undo")
	ErrUndoConflict  = errors.New("later changes touched the same lines")
)

func (s *Service) Undo(ctx context.Context, rev, p string, current []byte) ([]byte, error) {
	change, err := s.Change(ctx, rev, p)
	if err != nil {
		return nil, err
	}
	if change.Before == "" || change.After == "" || change.Before == change.After {
		return nil, fmt.Errorf("history: undo %s %q: %w", rev, p, ErrNothingToUndo)
	}

	out, err := s.run(ctx, command{args: []string{"hash-object", "-w", "--stdin"}, stdin: current})
	if err != nil {
		return nil, fmt.Errorf("history: undo %s %q: %w", rev, p, err)
	}
	ours := strings.TrimSpace(string(out))

	args := []string{"merge-file", "-p", "--object-id", ours, change.After, change.Before}
	merged, err := s.run(ctx, command{args: args, limit: maxBlobBytes})
	if code := exitCode(err); code > 0 && code <= maxConflictExit {
		return nil, fmt.Errorf("history: undo %s %q: %w", rev, p, ErrUndoConflict)
	}
	if err != nil {
		return nil, fmt.Errorf("history: undo %s %q: %w", rev, p, err)
	}
	return merged, nil
}
