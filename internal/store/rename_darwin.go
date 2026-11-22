package store

import (
	"errors"
	"fmt"
	"os"

	"golang.org/x/sys/unix"
)

func renameExcl(fromDir *os.File, fromName string, toDir *os.File, toName string) error {
	err := unix.RenameatxNp(int(fromDir.Fd()), fromName, int(toDir.Fd()), toName, unix.RENAME_EXCL)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, unix.ENOTSUP), errors.Is(err, unix.EINVAL), errors.Is(err, unix.ENOSYS):
		return fmt.Errorf("renameatx_np: %w: %w", errors.ErrUnsupported, err)
	}
	return &os.LinkError{Op: "renameatx_np", Old: fromName, New: toName, Err: err}
}
