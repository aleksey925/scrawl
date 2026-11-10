//go:build !linux && !darwin

package store

import (
	"errors"
	"os"
)

func renameExcl(*os.File, string, *os.File, string) error {
	return errors.ErrUnsupported
}
