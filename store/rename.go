package store

import (
	"errors"
	"path"
)

func (s *Store) renameNoReplace(from, to string) error {
	fromDir, err := s.root.Open(path.Dir(from))
	if err != nil {
		return err
	}
	defer fromDir.Close()
	toDir, err := s.root.Open(path.Dir(to))
	if err != nil {
		return err
	}
	defer toDir.Close()

	err = renameExcl(fromDir, path.Base(from), toDir, path.Base(to))
	if errors.Is(err, errors.ErrUnsupported) {
		return s.root.Rename(from, to)
	}
	return err
}
