package store

import (
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
)

func (s *Store) ImageSize(p string) (width, height int, ok bool) {
	f, _, err := s.Open(p)
	if err != nil {
		return 0, 0, false
	}
	defer f.Close()
	cfg, _, err := image.DecodeConfig(f)
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 {
		return 0, 0, false
	}
	return cfg.Width, cfg.Height, true
}
