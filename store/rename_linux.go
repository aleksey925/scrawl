package store

import (
	"errors"
	"fmt"
	"os"

	"golang.org/x/sys/unix"
)

func renameExcl(fromDir *os.File, fromName string, toDir *os.File, toName string) error {
	err := unix.Renameat2(int(fromDir.Fd()), fromName, int(toDir.Fd()), toName, unix.RENAME_NOREPLACE)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, unix.EINVAL), errors.Is(err, unix.ENOSYS):
		return fmt.Errorf("renameat2: %w: %w", errors.ErrUnsupported, err)
	}
	return &os.LinkError{Op: "renameat2", Old: fromName, New: toName, Err: err}
}
