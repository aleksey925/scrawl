package store

import (
	"cmp"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

const (
	tmpSuffix = ".scrawl-tmp"
	dirPerm   = fs.FileMode(0o755)
	filePerm  = fs.FileMode(0o644)

	defaultTreeTTL  = 5 * time.Second
	defaultDebounce = 300 * time.Millisecond
	defaultRescan   = time.Minute
)

var defaultExcluded = []string{"node_modules", "__pycache__"}

type FileInfo struct {
	Path    string
	Name    string
	IsDir   bool
	Size    int64
	ModTime time.Time
}

type Config struct {
	Root     string
	Exclude  []string
	ReadOnly bool

	Watch    WatchMode
	TreeTTL  time.Duration
	Debounce time.Duration
	Rescan   time.Duration
}

type Store struct {
	cfg  Config
	dir  string
	root *os.Root

	writeMu sync.Mutex

	treeMu    sync.Mutex
	tree      *Node
	treeAt    time.Time
	treeDirty bool
}

func New(cfg Config) (*Store, error) {
	dir, err := filepath.Abs(cfg.Root)
	if err != nil {
		return nil, fmt.Errorf("absolute path for root %q: %w", cfg.Root, err)
	}

	fi, err := os.Stat(dir)
	if err != nil {
		return nil, fmt.Errorf("root %q: %w", dir, err)
	}
	if !fi.IsDir() {
		return nil, fmt.Errorf("root %q is not a directory", dir)
	}

	for _, glob := range cfg.Exclude {
		if _, matchErr := path.Match(glob, "probe"); matchErr != nil {
			return nil, fmt.Errorf("exclude glob %q: %w", glob, matchErr)
		}
	}

	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("open root %q: %w", dir, err)
	}

	s := &Store{cfg: withDefaults(cfg), dir: dir, root: root}
	s.sweepTemp()
	return s, nil
}

func withDefaults(cfg Config) Config {
	if cfg.Watch == "" {
		cfg.Watch = WatchAuto
	}
	if cfg.TreeTTL <= 0 {
		cfg.TreeTTL = defaultTreeTTL
	}
	if cfg.Debounce <= 0 {
		cfg.Debounce = defaultDebounce
	}
	if cfg.Rescan == 0 {
		cfg.Rescan = defaultRescan
	}
	return cfg
}

func (s *Store) Close() error {
	if err := s.root.Close(); err != nil {
		return fmt.Errorf("close root %q: %w", s.dir, err)
	}
	return nil
}

func (s *Store) Dir() string { return s.dir }

func (s *Store) ReadOnly() bool { return s.cfg.ReadOnly }

func Rev(data []byte) string {
	sum := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func (s *Store) Stat(p string) (FileInfo, error) {
	cleaned, err := s.checkPath(p)
	if err != nil {
		return FileInfo{}, err
	}
	fi, err := s.root.Lstat(cleaned)
	if err != nil {
		return FileInfo{}, osError("stat", p, err)
	}
	return info(cleaned, fi), nil
}

func (s *Store) Exists(p string) bool {
	cleaned, err := s.checkPath(p)
	if err != nil {
		return false
	}
	_, err = s.root.Lstat(cleaned)
	return err == nil
}

func (s *Store) Visible(p string) bool {
	_, err := s.checkPath(p)
	return err == nil
}

func (s *Store) List(dir string) ([]FileInfo, error) {
	cleaned, err := s.checkPath(dir)
	if err != nil {
		return nil, err
	}
	return s.list(cleaned)
}

func (s *Store) list(cleaned string) ([]FileInfo, error) {
	entries, err := fs.ReadDir(s.root.FS(), cleaned)
	if err != nil {
		return nil, osError("list", displayPath(cleaned), err)
	}

	res := make([]FileInfo, 0, len(entries))
	for _, ent := range entries {
		child := join(cleaned, ent.Name())
		if s.unlisted(child, ent) {
			continue
		}
		fi, infoErr := ent.Info()
		if infoErr != nil {
			continue
		}
		res = append(res, info(child, fi))
	}

	slices.SortFunc(res, byDirThenName)
	return res, nil
}

func (s *Store) Count(dir string) (int, error) {
	cleaned, err := s.checkPath(dir)
	if err != nil {
		return 0, err
	}
	entries, err := fs.ReadDir(s.root.FS(), cleaned)
	if err != nil {
		return 0, osError("list", displayPath(cleaned), err)
	}
	res := 0
	for _, ent := range entries {
		if !s.unlisted(join(cleaned, ent.Name()), ent) {
			res++
		}
	}
	return res, nil
}

func (s *Store) unlisted(full string, ent fs.DirEntry) bool {
	return s.excluded(full, ent.Name()) || ent.Type()&fs.ModeSymlink != 0
}

func (s *Store) Open(p string) (io.ReadSeekCloser, FileInfo, error) {
	cleaned, err := s.checkPath(p)
	if err != nil {
		return nil, FileInfo{}, err
	}

	f, err := s.root.Open(cleaned)
	if err != nil {
		return nil, FileInfo{}, osError("open", p, err)
	}
	fi, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, FileInfo{}, osError("open", p, err)
	}
	if fi.IsDir() {
		_ = f.Close()
		return nil, FileInfo{}, fmt.Errorf("open %q: %w", p, ErrIsDir)
	}
	return f, info(cleaned, fi), nil
}

func (s *Store) Read(p string) ([]byte, FileInfo, error) {
	f, fi, err := s.Open(p)
	if err != nil {
		return nil, FileInfo{}, err
	}
	defer f.Close()

	data, err := io.ReadAll(f)
	if err != nil {
		return nil, FileInfo{}, fmt.Errorf("read %q: %w", p, err)
	}
	return data, fi, nil
}

func (s *Store) CheckWritable() error {
	if s.cfg.ReadOnly {
		return fmt.Errorf("write probe: %w", ErrReadOnly)
	}
	suffix, err := randomSuffix()
	if err != nil {
		return fmt.Errorf("write probe: %w", err)
	}
	name := "probe-" + suffix + tmpSuffix

	f, err := s.root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, filePerm)
	if err != nil {
		return osError("write probe", name, err)
	}
	if closeErr := f.Close(); closeErr != nil {
		return osError("write probe", name, closeErr)
	}
	if rmErr := s.root.Remove(name); rmErr != nil {
		return osError("write probe", name, rmErr)
	}
	return nil
}

func (s *Store) Write(p string, data []byte, rev string) (FileInfo, error) {
	if s.cfg.ReadOnly {
		return FileInfo{}, fmt.Errorf("write %q: %w", p, ErrReadOnly)
	}
	cleaned, err := s.checkPath(p)
	if err != nil {
		return FileInfo{}, err
	}
	if cleaned == "." {
		return FileInfo{}, fmt.Errorf("write %q: %w", p, ErrIsDir)
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	if revErr := s.checkRev(cleaned, rev); revErr != nil {
		return FileInfo{}, revErr
	}
	if writeErr := s.writeAtomic(cleaned, data); writeErr != nil {
		return FileInfo{}, writeErr
	}
	s.invalidate()

	fi, err := s.root.Lstat(cleaned)
	if err != nil {
		return FileInfo{}, osError("write", p, err)
	}
	return info(cleaned, fi), nil
}

func (s *Store) checkRev(cleaned, rev string) error {
	current, err := s.root.ReadFile(cleaned)
	switch {
	case err == nil && rev == "":
		return fmt.Errorf("write %q: %w", cleaned, ErrExists)
	case err == nil && Rev(current) != rev:
		return &ConflictError{Path: cleaned, CurrentRev: Rev(current), Current: current}
	case err == nil:
		return nil
	case !errors.Is(err, fs.ErrNotExist):
		return osError("write", cleaned, err)
	case rev != "":
		return &ConflictError{Path: cleaned}
	}
	return nil
}

func (s *Store) Create(p string, isDir bool) (FileInfo, error) {
	if s.cfg.ReadOnly {
		return FileInfo{}, fmt.Errorf("create %q: %w", p, ErrReadOnly)
	}
	cleaned, err := s.checkPath(p)
	if err != nil {
		return FileInfo{}, err
	}
	if cleaned == "." {
		return FileInfo{}, fmt.Errorf("create %q: %w", p, ErrExists)
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	if _, statErr := s.root.Lstat(cleaned); statErr == nil {
		return FileInfo{}, fmt.Errorf("create %q: %w", p, ErrExists)
	}
	if createErr := s.create(cleaned, isDir); createErr != nil {
		return FileInfo{}, osError("create", p, createErr)
	}
	s.invalidate()

	fi, err := s.root.Lstat(cleaned)
	if err != nil {
		return FileInfo{}, osError("create", p, err)
	}
	return info(cleaned, fi), nil
}

func (s *Store) create(cleaned string, isDir bool) error {
	if isDir {
		return s.root.MkdirAll(cleaned, dirPerm)
	}
	if err := s.mkParent(cleaned); err != nil {
		return err
	}
	f, err := s.root.OpenFile(cleaned, os.O_WRONLY|os.O_CREATE|os.O_EXCL, filePerm)
	if err != nil {
		return err
	}
	return f.Close()
}

func (s *Store) Remove(p string) error {
	return s.remove(p, s.root.Remove)
}

func (s *Store) RemoveAll(p string) error {
	return s.remove(p, s.root.RemoveAll)
}

func (s *Store) remove(p string, del func(name string) error) error {
	if s.cfg.ReadOnly {
		return fmt.Errorf("remove %q: %w", p, ErrReadOnly)
	}
	cleaned, err := s.checkPath(p)
	if err != nil {
		return err
	}
	if cleaned == "." {
		return fmt.Errorf("remove %q: %w", p, ErrForbidden)
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	if _, err := s.root.Lstat(cleaned); err != nil {
		return osError("remove", p, err)
	}
	if err := del(cleaned); err != nil {
		return osError("remove", p, err)
	}
	s.invalidate()
	return nil
}

func (s *Store) Move(from, to string) error {
	if s.cfg.ReadOnly {
		return fmt.Errorf("move %q: %w", from, ErrReadOnly)
	}
	src, err := s.checkPath(from)
	if err != nil {
		return err
	}
	dst, err := s.checkPath(to)
	if err != nil {
		return err
	}
	if src == "." || dst == "." {
		return fmt.Errorf("move %q: %w", from, ErrForbidden)
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	if _, err := s.root.Lstat(src); err != nil {
		return osError("move", from, err)
	}
	if _, err := s.root.Lstat(dst); err == nil {
		return fmt.Errorf("move %q: %w", to, ErrExists)
	}
	if err := s.mkParent(dst); err != nil {
		return osError("move", to, err)
	}
	if err := s.root.Rename(src, dst); err != nil {
		return osError("move", from, err)
	}
	s.invalidate()
	return nil
}

func (s *Store) Walk(fn func(fi FileInfo, data []byte) error) error {
	return s.walkVisible(func(p string, d fs.DirEntry) error {
		if !isMarkdown(d.Name()) {
			return nil
		}
		return s.walkFile(p, fn)
	})
}

func (s *Store) Files() ([]FileInfo, error) {
	res := []FileInfo{}
	err := s.walkVisible(func(p string, d fs.DirEntry) error {
		fi, infoErr := d.Info()
		if infoErr != nil {
			return walkFailure(p, d, infoErr)
		}
		res = append(res, info(p, fi))
		return nil
	})
	if err != nil {
		return nil, err
	}
	slices.SortFunc(res, func(a, b FileInfo) int { return cmp.Compare(a.Path, b.Path) })
	return res, nil
}

func (s *Store) walkVisible(fn func(p string, d fs.DirEntry) error) error {
	err := fs.WalkDir(s.root.FS(), ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return walkFailure(p, d, err)
		}
		if p == "." {
			return nil
		}
		if d.IsDir() {
			if s.excluded(p, d.Name()) {
				return fs.SkipDir
			}
			return nil
		}
		if d.Type()&fs.ModeSymlink != 0 || s.excluded(p, d.Name()) {
			return nil
		}
		return fn(p, d)
	})
	if err != nil {
		return fmt.Errorf("walk %q: %w", s.dir, err)
	}
	return nil
}

func (s *Store) walkFile(p string, fn func(fi FileInfo, data []byte) error) error {
	data, fi, err := s.Read(p)
	if err != nil {
		return walkFailure(p, nil, err)
	}
	return fn(fi, data)
}

func walkFailure(p string, d fs.DirEntry, err error) error {
	switch {
	case errors.Is(err, fs.ErrNotExist), errors.Is(err, ErrNotFound):
		return nil
	case errors.Is(err, fs.ErrPermission), errors.Is(err, ErrPermission):
		name := displayPath(p)
		if name == "" {
			name = "the notes root"
		}
		log.Printf("[WARN] skipping %s: permission denied, it must be readable by the user the server runs as", name)
		if d != nil && d.IsDir() {
			return fs.SkipDir
		}
		return nil
	}
	return err
}

func (s *Store) writeAtomic(cleaned string, data []byte) (err error) {
	perm := filePerm
	if fi, statErr := s.root.Lstat(cleaned); statErr == nil {
		perm = fi.Mode().Perm()
	}
	if err = s.mkParent(cleaned); err != nil {
		return osError("write", cleaned, err)
	}

	suffix, err := randomSuffix()
	if err != nil {
		return fmt.Errorf("write %q: %w", cleaned, err)
	}
	tmp := cleaned + "." + suffix + tmpSuffix

	f, err := s.root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, perm)
	if err != nil {
		return osError("write", cleaned, err)
	}
	defer func() {
		if err != nil {
			_ = f.Close()
			_ = s.root.Remove(tmp)
		}
	}()

	if _, err = f.Write(data); err != nil {
		return osError("write", cleaned, err)
	}
	if err = f.Sync(); err != nil {
		return osError("write", cleaned, err)
	}
	if err = f.Close(); err != nil {
		return osError("write", cleaned, err)
	}
	if err = s.root.Rename(tmp, cleaned); err != nil {
		return osError("write", cleaned, err)
	}
	return s.syncDir(path.Dir(cleaned))
}

func (s *Store) syncDir(dir string) error {
	d, err := s.root.Open(dir)
	if err != nil {
		return osError("sync", dir, err)
	}
	defer d.Close()

	if err := d.Sync(); err != nil {
		return osError("sync", dir, err)
	}
	return nil
}

func (s *Store) mkParent(cleaned string) error {
	dir := path.Dir(cleaned)
	if dir == "." {
		return nil
	}
	return s.root.MkdirAll(dir, dirPerm)
}

func (s *Store) sweepTemp() {
	err := filepath.WalkDir(s.dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(d.Name(), tmpSuffix) {
			return nil //nolint:nilerr // an unreadable entry is not worth aborting the sweep
		}
		if rmErr := os.Remove(p); rmErr != nil {
			log.Printf("[WARN] remove leftover temp file %s: %v", p, rmErr)
			return nil
		}
		log.Printf("[DEBUG] removed leftover temp file %s", p)
		return nil
	})
	if err != nil {
		log.Printf("[WARN] sweep temp files in %s: %v", s.dir, err)
	}
}

func (s *Store) checkPath(p string) (string, error) {
	cleaned, err := cleanPath(p)
	if err != nil {
		return "", err
	}
	if cleaned == "." {
		return cleaned, nil
	}

	prefix := ""
	for seg := range strings.SplitSeq(cleaned, "/") {
		prefix = join(prefix, seg)
		if s.excluded(prefix, seg) || s.isSymlink(prefix) {
			return "", fmt.Errorf("path %q: %w", p, ErrNotFound)
		}
	}
	return cleaned, nil
}

func (s *Store) isSymlink(cleaned string) bool {
	fi, err := s.root.Lstat(cleaned)
	if err != nil {
		return false
	}
	return fi.Mode()&fs.ModeSymlink != 0
}

func (s *Store) excluded(full, name string) bool {
	if strings.HasPrefix(name, ".") || strings.HasSuffix(name, tmpSuffix) {
		return true
	}
	if slices.Contains(defaultExcluded, name) {
		return true
	}
	for _, glob := range s.cfg.Exclude {
		if ok, _ := path.Match(glob, name); ok {
			return true
		}
		if ok, _ := path.Match(glob, full); ok {
			return true
		}
	}
	return false
}

func (s *Store) excludedPath(cleaned string) bool {
	prefix := ""
	for seg := range strings.SplitSeq(cleaned, "/") {
		prefix = join(prefix, seg)
		if s.excluded(prefix, seg) {
			return true
		}
	}
	return false
}

func cleanPath(p string) (string, error) {
	p = strings.TrimPrefix(p, "/")
	p = strings.TrimSuffix(p, "/")
	if p == "" || p == "." {
		return ".", nil
	}
	if strings.ContainsRune(p, 0) {
		return "", fmt.Errorf("path %q: %w", p, ErrForbidden)
	}

	cleaned := path.Clean(p)
	if !fs.ValidPath(cleaned) {
		return "", fmt.Errorf("path %q: %w", p, ErrForbidden)
	}
	return cleaned, nil
}

func info(cleaned string, fi fs.FileInfo) FileInfo {
	res := FileInfo{IsDir: fi.IsDir(), Size: fi.Size(), ModTime: fi.ModTime()}
	if cleaned == "." {
		return res
	}
	res.Path, res.Name = cleaned, path.Base(cleaned)
	return res
}

func byDirThenName(a, b FileInfo) int {
	if a.IsDir != b.IsDir {
		if a.IsDir {
			return -1
		}
		return 1
	}
	if res := cmp.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)); res != 0 {
		return res
	}
	return cmp.Compare(a.Name, b.Name)
}

func isMarkdown(name string) bool { return strings.EqualFold(path.Ext(name), ".md") }

func join(dir, name string) string {
	if dir == "" || dir == "." {
		return name
	}
	return dir + "/" + name
}

func displayPath(cleaned string) string {
	if cleaned == "." {
		return ""
	}
	return cleaned
}
