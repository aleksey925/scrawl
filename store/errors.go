package store

import (
	"errors"
	"fmt"
	"io/fs"
	"syscall"
)

var (
	// ErrNotFound is returned for a path that does not exist, is hidden by the
	// ignore rules or contains a symlink.
	ErrNotFound = errors.New("not found")
	// ErrExists is returned when the target of a create, move or write with an
	// empty revision is already taken.
	ErrExists = errors.New("already exists")
	// ErrIsDir is returned when a file operation is aimed at a directory.
	ErrIsDir = errors.New("is a directory")
	// ErrNotEmpty is returned when removing a directory that still has entries.
	ErrNotEmpty = errors.New("directory is not empty")
	// ErrReadOnly is returned by every mutating method when the store runs in
	// read-only mode.
	ErrReadOnly = errors.New("store is read-only")
	// ErrTooLarge is returned when an upload exceeds the size cap.
	ErrTooLarge = errors.New("too large")
	// ErrForbidden is returned for a path that escapes the root and for an
	// upload the store refuses to keep.
	ErrForbidden = errors.New("forbidden")
	// ErrConflict is returned when a file changed on disk since the caller read
	// it. The full detail is carried by *ConflictError.
	ErrConflict = errors.New("revision conflict")
)

// ConflictError reports that a file changed on disk since the caller read it.
// It carries the current revision and content, so the editor can show a diff
// instead of losing the edit. It matches errors.Is(err, ErrConflict).
type ConflictError struct {
	Path       string
	CurrentRev string
	Current    []byte
}

// Error implements the error interface.
func (e *ConflictError) Error() string {
	return fmt.Sprintf("write %q: %v, current revision %s", e.Path, ErrConflict, e.CurrentRev)
}

// Unwrap makes errors.Is(err, ErrConflict) match.
func (e *ConflictError) Unwrap() error { return ErrConflict }

// osError translates an error from the os layer into one of the package
// sentinels. Callers map those onto HTTP statuses, so every failure mode the
// API can hit has to arrive as a known error and not as a raw syscall errno.
func osError(op, p string, err error) error {
	switch {
	case errors.Is(err, fs.ErrNotExist), errors.Is(err, syscall.ENOTDIR):
		return fmt.Errorf("%s %q: %w", op, p, ErrNotFound)
	case errors.Is(err, syscall.ENOTEMPTY):
		return fmt.Errorf("%s %q: %w", op, p, ErrNotEmpty)
	case errors.Is(err, fs.ErrExist):
		return fmt.Errorf("%s %q: %w", op, p, ErrExists)
	case errors.Is(err, syscall.EISDIR):
		return fmt.Errorf("%s %q: %w", op, p, ErrIsDir)
	case errors.Is(err, fs.ErrPermission):
		return fmt.Errorf("%s %q: %w", op, p, ErrForbidden)
	}
	return fmt.Errorf("%s %q: %w", op, p, err)
}
