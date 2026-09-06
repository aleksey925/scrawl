// Package store is the only place in mdserver that touches the knowledge base
// directory. Every path it takes is relative to the root, slash-separated and
// without a leading slash; "" means the root itself. All access goes through
// os.Root, so escaping the root is impossible by construction instead of by
// string checks.
//
// Two policies shape what the rest of the app can see:
//
// Ignored entries are invisible everywhere, not only in listings. Hidden
// entries (a leading dot), node_modules, __pycache__, leftover temp files and
// anything matching Config.Exclude report ErrNotFound from Stat, Read and
// Open too, so a request for ".git/config" cannot leak a thing.
//
// Symlinks are not part of the knowledge base. They are skipped in listings
// and every method reports ErrNotFound for a path with a symlink anywhere in
// it, checked component by component. Following them would let a link named
// "docs" pointing at ".git" walk around the ignore rules, and it would make
// the visible tree disagree with what is readable.
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
	tmpSuffix = ".mdserver-tmp"
	dirPerm   = fs.FileMode(0o755)
	filePerm  = fs.FileMode(0o644)

	defaultTreeTTL  = 5 * time.Second
	defaultDebounce = 300 * time.Millisecond
	defaultRescan   = time.Minute
)

// defaultExcluded are the directory names hidden on top of every dot-entry.
var defaultExcluded = []string{"node_modules", "__pycache__"}

// FileInfo describes one entry of the knowledge base.
type FileInfo struct {
	Path    string // relative to the root, slash-separated, no leading slash
	Name    string // base name, empty for the root itself
	IsDir   bool
	Size    int64
	ModTime time.Time
}

// Config holds everything the store needs. Only Root is mandatory.
type Config struct {
	Root     string   // knowledge base directory
	Exclude  []string // extra ignore globs, matched against both the entry name and its path
	ReadOnly bool     // make every mutating method fail with ErrReadOnly

	Watch    WatchMode     // change source behind Watch, empty means WatchAuto
	TreeTTL  time.Duration // max age of the cached tree, 0 means 5s
	Debounce time.Duration // watcher debounce window, 0 means 300ms
	Rescan   time.Duration // periodic full rescan, 0 means 60s, negative disables it
}

// Store gives safe access to the knowledge base directory.
type Store struct {
	cfg  Config
	dir  string // absolute path of the root, needed by the watcher
	root *os.Root

	// writeMu serializes mutations, so the revision check of Write and the
	// existence checks of Create, Move and Upload cannot be raced from inside
	// this process.
	writeMu sync.Mutex

	treeMu    sync.Mutex
	tree      *Node
	treeAt    time.Time
	treeDirty bool
}

// New opens the knowledge base root and sweeps temp files left behind by a
// crash. The returned store must be closed.
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

// Close releases the root handle. Watchers stop with their own context.
func (s *Store) Close() error {
	if err := s.root.Close(); err != nil {
		return fmt.Errorf("close root %q: %w", s.dir, err)
	}
	return nil
}

// Dir returns the absolute path of the knowledge base root.
func (s *Store) Dir() string { return s.dir }

// ReadOnly reports whether mutating methods are refused.
func (s *Store) ReadOnly() bool { return s.cfg.ReadOnly }

// Rev returns the revision token of data: the sha256 digest used for
// optimistic concurrency control on Write.
func Rev(data []byte) string {
	sum := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(sum[:])
}

// Stat reports the entry at p.
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

// Exists reports whether p points at a visible entry.
func (s *Store) Exists(p string) bool {
	cleaned, err := s.checkPath(p)
	if err != nil {
		return false
	}
	_, err = s.root.Lstat(cleaned)
	return err == nil
}

// List returns the visible entries of a directory, directories first and then
// files, both case-insensitively by name, so the UI never has to sort.
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
		if s.excluded(child, ent.Name()) || ent.Type()&fs.ModeSymlink != 0 {
			continue
		}
		fi, infoErr := ent.Info()
		if infoErr != nil {
			continue // vanished between readdir and stat, nothing to report
		}
		res = append(res, info(child, fi))
	}

	slices.SortFunc(res, byDirThenName)
	return res, nil
}

// Open returns a reader for a file. The caller closes it.
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

// Read returns the whole content of a file.
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

// CheckWritable reports whether the root really takes a write, by creating a
// temp file in it and removing it again. Being able to read a directory says
// nothing about writing to it, and the temp suffix keeps the probe invisible
// even if the process dies between the two steps.
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

// Write replaces a file atomically. An empty rev means "create", and fails
// with ErrExists when the file is already there. A non-empty rev must match
// the revision on disk, otherwise the write is refused with a *ConflictError
// carrying the current revision and content. Content is stored byte for byte:
// trailing whitespace and a missing final newline are never touched.
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

// checkRev compares the revision the caller edited with the one on disk.
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
		// the file was removed while the editor had it open, which is a
		// conflict too: an empty current revision tells the caller so
		return &ConflictError{Path: cleaned}
	}
	return nil
}

// Create makes an empty file or a directory, together with missing parents.
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

// Remove deletes a file or an empty directory.
func (s *Store) Remove(p string) error {
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
	if err := s.root.Remove(cleaned); err != nil {
		return osError("remove", p, err)
	}
	s.invalidate()
	return nil
}

// Move renames a file or a directory, creating missing parents of the target.
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

// Walk calls fn for every visible markdown file, in lexical order. Ignored
// entries, symlinks and non-markdown files are skipped, so the search index
// sees exactly what the UI shows.
func (s *Store) Walk(fn func(fi FileInfo, data []byte) error) error {
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
		if d.Type()&fs.ModeSymlink != 0 || s.excluded(p, d.Name()) || !isMarkdown(d.Name()) {
			return nil
		}
		return s.walkFile(p, fn)
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

// walkFailure decides what a failure on one entry means for the whole walk. A
// vanished entry is normal on a live directory, and an unreadable one is a
// deployment problem worth naming rather than a reason to abandon the rest of
// a knowledge base that reads perfectly well.
func walkFailure(p string, d fs.DirEntry, err error) error {
	switch {
	case errors.Is(err, fs.ErrNotExist), errors.Is(err, ErrNotFound):
		return nil
	case errors.Is(err, fs.ErrPermission), errors.Is(err, ErrPermission):
		name := displayPath(p)
		if name == "" {
			name = "the knowledge base root"
		}
		log.Printf("[WARN] skipping %s: permission denied, it must be readable by the user the server runs as", name)
		if d != nil && d.IsDir() {
			return fs.SkipDir
		}
		return nil
	}
	return err
}

// writeAtomic replaces cleaned through a temp file in the same directory plus
// a rename, so a concurrent reader never sees half a document. The mode of an
// existing file is kept, a new one gets filePerm minus the umask.
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

	// O_CREATE|O_EXCL matters: os.Root never follows a symlink when both are
	// set, so a link planted at the temp path cannot redirect the write
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
	// fsync before the rename, otherwise a power cut on the NAS can leave the
	// renamed file with the right name and no content
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

// syncDir fsyncs the containing directory so the rename itself survives a
// power cut.
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

// sweepTemp drops temp files a crash left behind, so they neither confuse the
// listing nor block a later write.
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

// checkPath cleans p and refuses everything that has to stay invisible:
// paths escaping the root, ignored entries and symlinks. Both are checked
// component by component, because a link to an ignored directory would
// otherwise walk around the ignore rules.
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

// isSymlink reports whether an existing entry is a symlink. A path that is not
// there yet cannot be one, and the operation itself reports what is missing.
func (s *Store) isSymlink(cleaned string) bool {
	fi, err := s.root.Lstat(cleaned)
	if err != nil {
		return false
	}
	return fi.Mode()&fs.ModeSymlink != 0
}

// excluded reports whether an entry is hidden from the whole app. full is the
// path relative to the root, name its last component.
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

// excludedPath reports whether any component of a cleaned path is ignored.
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

// cleanPath turns an API path into the slash form os.Root expects. A leading
// slash is dropped, so an absolute-looking request stays inside the root, and
// anything that would climb above the root is refused. A ".." that stays
// inside is legal and kept, exactly like os.Root treats it.
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

// info builds a FileInfo for a cleaned path. The root reports an empty path
// and an empty name, everything else its own.
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

// join appends name to a cleaned path, keeping "" and "." out of the result.
func join(dir, name string) string {
	if dir == "" || dir == "." {
		return name
	}
	return dir + "/" + name
}

// displayPath renders a cleaned path the way the API spells it.
func displayPath(cleaned string) string {
	if cleaned == "." {
		return ""
	}
	return cleaned
}
