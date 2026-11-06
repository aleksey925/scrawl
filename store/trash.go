package store

import (
	"crypto/rand"
	"fmt"
	"io/fs"
	"log"
	"path"
	"time"
)

const (
	trashDir = ".scrawl-trash"

	trashKeep = 5 * time.Minute
)

type trashed struct {
	path string
	at   time.Time
}

func (s *Store) Discard(p string, recursive bool) (string, error) {
	if s.cfg.ReadOnly {
		return "", fmt.Errorf("remove %q: %w", p, ErrReadOnly)
	}
	cleaned, err := s.checkPath(p)
	if err != nil {
		return "", err
	}
	if cleaned == "." {
		return "", fmt.Errorf("remove %q: %w", p, ErrForbidden)
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	fi, err := s.root.Lstat(cleaned)
	if err != nil {
		return "", osError("remove", p, err)
	}
	if fi.IsDir() && !recursive {
		entries, readErr := fs.ReadDir(s.root.FS(), cleaned)
		if readErr != nil {
			return "", osError("remove", p, readErr)
		}
		if len(entries) > 0 {
			return "", fmt.Errorf("remove %q: %w", p, ErrNotEmpty)
		}
	}

	id := rand.Text()
	slot := path.Join(trashDir, id)
	if err = s.root.MkdirAll(slot, dirPerm); err != nil {
		return "", osError("remove", p, err)
	}
	if err = s.root.Rename(cleaned, path.Join(slot, path.Base(cleaned))); err != nil {
		s.dropSlot(id)
		return "", osError("remove", p, err)
	}
	s.trash[id] = trashed{path: cleaned, at: time.Now()}
	s.invalidate()
	return id, nil
}

func (s *Store) Trashed(id string) (string, bool) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	item, ok := s.trash[id]
	return displayPath(item.path), ok
}

func (s *Store) Recover(id string) error {
	if s.cfg.ReadOnly {
		return fmt.Errorf("recover %q: %w", id, ErrReadOnly)
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	item, ok := s.trash[id]
	if !ok {
		return fmt.Errorf("recover %q: %w", id, ErrNotFound)
	}
	p := displayPath(item.path)
	if _, err := s.root.Lstat(item.path); err == nil {
		return fmt.Errorf("recover %q: %w", p, ErrExists)
	}
	if err := s.mkParent(item.path); err != nil {
		return osError("recover", p, err)
	}
	if err := s.root.Rename(path.Join(trashDir, id, path.Base(item.path)), item.path); err != nil {
		return osError("recover", p, err)
	}
	delete(s.trash, id)
	s.dropSlot(id)
	s.emptyUnusedTrash()
	s.invalidate()
	return nil
}

func (s *Store) SweepTrash(now time.Time) {
	if s.cfg.ReadOnly {
		return
	}
	for _, id := range s.takeExpired(now) {
		s.dropSlot(id)
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	s.emptyUnusedTrash()
}

func (s *Store) takeExpired(now time.Time) []string {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	var expired []string
	for id, item := range s.trash {
		if now.Sub(item.at) >= trashKeep {
			delete(s.trash, id)
			expired = append(expired, id)
		}
	}
	return expired
}

func (s *Store) emptyUnusedTrash() {
	if len(s.trash) == 0 {
		s.emptyTrash()
	}
}

func (s *Store) dropSlot(id string) {
	if err := s.root.RemoveAll(path.Join(trashDir, id)); err != nil {
		log.Printf("[WARN] empty the trash slot %s of %s: %v", id, s.dir, err)
	}
}

func (s *Store) emptyTrash() {
	if err := s.root.RemoveAll(trashDir); err != nil {
		log.Printf("[WARN] empty the trash of %s: %v", s.dir, err)
	}
}
