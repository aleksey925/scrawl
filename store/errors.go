package store

import (
	"errors"
	"fmt"
	"io/fs"
	"syscall"
)

var (
	ErrNotFound   = errors.New("not found")
	ErrExists     = errors.New("already exists")
	ErrIsDir      = errors.New("is a directory")
	ErrNotEmpty   = errors.New("directory is not empty")
	ErrReadOnly   = errors.New("store is read-only")
	ErrTooLarge   = errors.New("too large")
	ErrForbidden  = errors.New("forbidden")
	ErrPermission = errors.New("permission denied")
	ErrConflict   = errors.New("revision conflict")
)

type ConflictError struct {
	Path       string
	CurrentRev string
	Current    []byte
}

func (e *ConflictError) Error() string {
	return fmt.Sprintf("write %q: %v, current revision %s", e.Path, ErrConflict, e.CurrentRev)
}

func (e *ConflictError) Unwrap() error { return ErrConflict }

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
		return fmt.Errorf("%s %q: %w", op, p, ErrPermission)
	}
	return fmt.Errorf("%s %q: %w", op, p, err)
}
