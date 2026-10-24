package store

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"path"
	"path/filepath"
	"slices"
	"strings"

	"golang.org/x/text/unicode/norm"
)

const (
	maxNameLen     = 64
	uniqueAttempts = 8
	sniffLen       = 512
)

var allowedUploads = map[string][]string{
	".png":  {"image/png"},
	".jpg":  {"image/jpeg"},
	".jpeg": {"image/jpeg"},
	".gif":  {"image/gif"},
	".webp": {"image/webp"},
	".pdf":  {"application/pdf"},
	".svg":  {"image/svg+xml", "text/xml", "text/plain"},
}

var cyrillic = map[rune]string{
	'а': "a", 'б': "b", 'в': "v", 'г': "g", 'д': "d", 'е': "e", 'ё': "e",
	'ж': "zh", 'з': "z", 'и': "i", 'й': "y", 'к': "k", 'л': "l", 'м': "m",
	'н': "n", 'о': "o", 'п': "p", 'р': "r", 'с': "s", 'т': "t", 'у': "u",
	'ф': "f", 'х': "h", 'ц': "ts", 'ч': "ch", 'ш': "sh", 'щ': "shch",
	'ъ': "", 'ы': "y", 'ь': "", 'э': "e", 'ю': "yu", 'я': "ya",
}

func (s *Store) Upload(dir, filename string, r io.Reader, maxSize int64) (FileInfo, error) {
	if s.cfg.ReadOnly {
		return FileInfo{}, fmt.Errorf("upload to %q: %w", dir, ErrReadOnly)
	}
	cleanedDir, err := s.checkPath(dir)
	if err != nil {
		return FileInfo{}, err
	}

	name, ext, err := sanitizeName(filename)
	if err != nil {
		return FileInfo{}, err
	}
	data, err := readLimited(r, maxSize)
	if err != nil {
		return FileInfo{}, err
	}
	if contentErr := checkContent(ext, data); contentErr != nil {
		return FileInfo{}, fmt.Errorf("upload %q: %w", filename, contentErr)
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	if cleanedDir != "." {
		if mkErr := s.root.MkdirAll(cleanedDir, dirPerm); mkErr != nil {
			return FileInfo{}, osError("upload", dir, mkErr)
		}
	}
	target, err := s.uniqueName(cleanedDir, name, ext)
	if err != nil {
		return FileInfo{}, err
	}
	if writeErr := s.writeAtomic(target, data); writeErr != nil {
		return FileInfo{}, writeErr
	}
	s.invalidate()

	fi, err := s.root.Lstat(target)
	if err != nil {
		return FileInfo{}, osError("upload", target, err)
	}
	return info(target, fi), nil
}

func readLimited(r io.Reader, maxSize int64) ([]byte, error) {
	if maxSize <= 0 {
		data, err := io.ReadAll(r)
		if err != nil {
			return nil, fmt.Errorf("read upload: %w", err)
		}
		return data, nil
	}

	data, err := io.ReadAll(io.LimitReader(r, maxSize+1))
	if err != nil {
		return nil, fmt.Errorf("read upload: %w", err)
	}
	if int64(len(data)) > maxSize {
		return nil, fmt.Errorf("upload of more than %d bytes: %w", maxSize, ErrTooLarge)
	}
	return data, nil
}

func sanitizeName(filename string) (name, ext string, err error) {
	base := path.Base(filepath.ToSlash(strings.ReplaceAll(filename, `\`, "/")))
	ext = strings.ToLower(path.Ext(base))
	if _, ok := allowedUploads[ext]; !ok {
		return "", "", fmt.Errorf("upload %q with extension %q: %w", filename, ext, ErrForbidden)
	}

	name = slugify(strings.TrimSuffix(base, path.Ext(base)))
	if name == "" {
		name = "file"
	}
	if len(name) > maxNameLen {
		name = strings.Trim(name[:maxNameLen], "-")
	}
	return name, ext, nil
}

func slugify(s string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(s) {
		if tr, ok := cyrillic[r]; ok {
			if tr != "" {
				b.WriteString(tr)
				dash = false
			}
			continue
		}
		if ascii := foldASCII(r); ascii != 0 {
			b.WriteByte(ascii)
			dash = false
			continue
		}
		if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
	}
	return strings.Trim(b.String(), "-")
}

func foldASCII(r rune) byte {
	if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
		return byte(r)
	}
	decomposed := []rune(norm.NFD.String(string(r)))
	if len(decomposed) > 0 {
		if base := decomposed[0]; base >= 'a' && base <= 'z' || base >= '0' && base <= '9' {
			return byte(base)
		}
	}
	return 0
}

func checkContent(ext string, data []byte) error {
	head := data
	if len(head) > sniffLen {
		head = head[:sniffLen]
	}
	detected, _, _ := strings.Cut(http.DetectContentType(head), ";")
	detected = strings.TrimSpace(detected)

	if !slices.Contains(allowedUploads[ext], detected) {
		return fmt.Errorf("content type %q does not match extension %q: %w", detected, ext, ErrForbidden)
	}
	if ext == ".svg" && !strings.Contains(strings.ToLower(string(head)), "<svg") {
		return fmt.Errorf("content is not an svg image: %w", ErrForbidden)
	}
	return nil
}

func (s *Store) uniqueName(dir, name, ext string) (string, error) {
	for attempt := range uniqueAttempts {
		candidate := name + ext
		if attempt > 0 {
			suffix, err := randomSuffix()
			if err != nil {
				return "", fmt.Errorf("upload %q: %w", name+ext, err)
			}
			candidate = name + "-" + suffix + ext
		}
		target := join(dir, candidate)
		if _, err := s.root.Lstat(target); errors.Is(err, fs.ErrNotExist) {
			return target, nil
		}
	}
	return "", fmt.Errorf("upload %q: %w", name+ext, ErrExists)
}

func randomSuffix() (string, error) {
	var buf [3]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", fmt.Errorf("random suffix: %w", err)
	}
	return hex.EncodeToString(buf[:]), nil
}
