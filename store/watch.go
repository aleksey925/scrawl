package store

import (
	"context"
	"errors"
	"io/fs"
	"log"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/fsnotify/fsnotify"
)

const (
	eventBuffer   = 64
	inotifyBuffer = 4096
)

type WatchMode string

const (
	WatchAuto WatchMode = "auto"
	WatchPoll WatchMode = "poll"
)

type Op uint8

const (
	OpCreate Op = 1 << iota
	OpWrite
	OpRemove
	OpRename
)

func (o Op) Has(other Op) bool { return o&other != 0 }

func (o Op) String() string {
	names := make([]string, 0, 4)
	for _, pair := range []struct {
		op   Op
		name string
	}{{OpCreate, "create"}, {OpWrite, "write"}, {OpRemove, "remove"}, {OpRename, "rename"}} {
		if o.Has(pair.op) {
			names = append(names, pair.name)
		}
	}
	if len(names) == 0 {
		return "none"
	}
	return strings.Join(names, "|")
}

type Event struct {
	Path string
	Op   Op
}

type Watcher interface {
	Run(ctx context.Context, out chan<- Event) bool
	Name() string
}

func (s *Store) Watch(ctx context.Context) <-chan Event {
	out := make(chan Event, eventBuffer)
	chain := s.watchers()
	go func() {
		defer close(out)
		runWatchers(ctx, out, chain...)
	}()
	return out
}

func (s *Store) watchers() []Watcher {
	tr := &tracker{store: s, pending: map[string]Op{}}
	tr.seen = tr.snapshot()
	if s.cfg.Watch == WatchPoll {
		return []Watcher{&pollWatcher{tracker: tr}}
	}
	return []Watcher{newFsWatcher(tr), &pollWatcher{tracker: tr}}
}

func runWatchers(ctx context.Context, out chan<- Event, chain ...Watcher) {
	for _, w := range chain {
		log.Printf("[DEBUG] change source: %s watcher", w.Name())
		if w.Run(ctx, out) {
			return
		}
	}
}

type tracker struct {
	store   *Store
	pending map[string]Op
	seen    map[string]fingerprint
}

type fingerprint struct {
	size  int64
	mtime int64
	isDir bool
}

func (t *tracker) mark(rel string, op Op) {
	t.pending[rel] |= op
	t.store.invalidate()
}

func (t *tracker) rel(name string) (string, bool) {
	rel, err := filepath.Rel(t.store.dir, name)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	cleaned := filepath.ToSlash(rel)
	if t.store.excludedPath(cleaned) {
		return "", false
	}
	return cleaned, true
}

func (t *tracker) markTree(dir string) {
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil //nolint:nilerr // an unreadable entry must not abort the walk
		}
		rel, ok := t.rel(p)
		if !ok {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		t.mark(rel, OpCreate)
		return nil
	})
	if err != nil {
		log.Printf("[WARN] scan new directory %s: %v", dir, err)
	}
}

func (t *tracker) flush(ctx context.Context, out chan<- Event) {
	for _, p := range slices.Sorted(maps.Keys(t.pending)) {
		select {
		case out <- Event{Path: p, Op: t.pending[p]}:
		case <-ctx.Done():
			return
		}
	}
	clear(t.pending)
}

func (t *tracker) rescan() bool {
	current := t.snapshot()
	changed := false

	for p, fp := range current {
		switch old, ok := t.seen[p]; {
		case !ok:
			t.mark(p, OpCreate)
			changed = true
		case old != fp && !fp.isDir:
			t.mark(p, OpWrite)
			changed = true
		}
	}
	for p := range t.seen {
		if _, ok := current[p]; !ok {
			t.mark(p, OpRemove)
			changed = true
		}
	}

	t.seen = current
	return changed
}

func (t *tracker) snapshot() map[string]fingerprint {
	res := map[string]fingerprint{}
	err := fs.WalkDir(t.store.root.FS(), ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil //nolint:nilerr // a partially readable tree still gives a usable snapshot
		}
		if p == "." {
			return nil
		}
		if t.store.excluded(p, d.Name()) {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.Type()&fs.ModeSymlink != 0 {
			return nil
		}
		fi, infoErr := d.Info()
		if infoErr != nil {
			return nil //nolint:nilerr // vanished between readdir and stat, nothing to fingerprint
		}
		res[p] = fingerprint{size: fi.Size(), mtime: fi.ModTime().UnixNano(), isDir: fi.IsDir()}
		return nil
	})
	if err != nil {
		log.Printf("[WARN] rescan %s: %v", t.store.dir, err)
	}
	return res
}

type pollWatcher struct{ *tracker }

func (w *pollWatcher) Name() string { return "poll" }

func (w *pollWatcher) Run(ctx context.Context, out chan<- Event) bool {
	interval := w.store.cfg.Rescan
	if interval <= 0 {
		interval = defaultRescan
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return true
		case <-ticker.C:
			if w.rescan() {
				w.flush(ctx, out)
			}
		}
	}
}

type fsWatcher struct {
	*tracker
	fsw       *fsnotify.Watcher
	exhausted bool
}

func newFsWatcher(tr *tracker) *fsWatcher {
	w := &fsWatcher{tracker: tr}

	fsw, err := fsnotify.NewBufferedWatcher(inotifyBuffer)
	if err != nil {
		log.Printf("[WARN] inotify is not available: %v", err)
		return w
	}
	w.fsw = fsw
	w.addTree(w.store.dir)
	return w
}

func (w *fsWatcher) Name() string { return "fsnotify" }

func (w *fsWatcher) Run(ctx context.Context, out chan<- Event) bool {
	if w.fsw == nil {
		return false
	}
	defer func() { _ = w.fsw.Close() }()

	if w.exhausted {
		return false
	}
	log.Printf("[DEBUG] watching %d directories under %s", len(w.fsw.WatchList()), w.store.dir)
	return w.loop(ctx, out)
}

func (w *fsWatcher) loop(ctx context.Context, out chan<- Event) bool {
	debounce := time.NewTimer(time.Hour)
	debounce.Stop()
	defer debounce.Stop()

	var rescan <-chan time.Time
	if w.store.cfg.Rescan > 0 {
		ticker := time.NewTicker(w.store.cfg.Rescan)
		defer ticker.Stop()
		rescan = ticker.C
	}

	for {
		select {
		case <-ctx.Done():
			return true
		case ev, ok := <-w.fsw.Events:
			if !ok {
				return false
			}
			if w.handle(ev) {
				debounce.Reset(w.store.cfg.Debounce)
			}
			if w.exhausted {
				w.flush(ctx, out)
				return false
			}
		case err, ok := <-w.fsw.Errors:
			if !ok {
				return false
			}
			log.Printf("[WARN] file watcher: %v", err)
		case <-debounce.C:
			w.flush(ctx, out)
		case <-rescan:
			changed := w.rescan()
			w.addTree(w.store.dir)
			if changed {
				w.flush(ctx, out)
			}
			if w.exhausted {
				return false
			}
		}
	}
}

func (w *fsWatcher) handle(ev fsnotify.Event) bool {
	if ev.Op == fsnotify.Chmod {
		return false
	}
	rel, ok := w.rel(ev.Name)
	if !ok {
		return false
	}

	if ev.Has(fsnotify.Create) {
		if fi, err := os.Stat(ev.Name); err == nil && fi.IsDir() {
			w.addTree(ev.Name)
			w.markTree(ev.Name)
			return true
		}
	}

	w.mark(rel, opOf(ev.Op))
	return true
}

func (w *fsWatcher) addTree(dir string) {
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return nil //nolint:nilerr // a directory removed mid-walk is normal
		}
		if p != dir {
			if _, ok := w.rel(p); !ok {
				return filepath.SkipDir
			}
		}
		if addErr := w.fsw.Add(p); addErr != nil {
			if errors.Is(addErr, syscall.ENOSPC) {
				log.Printf("[WARN] out of inotify watches after %d directories, falling back to polling; "+
					"raise fs.inotify.max_user_watches to keep instant updates", len(w.fsw.WatchList()))
				w.exhausted = true
				return filepath.SkipAll
			}
			log.Printf("[WARN] watch %s: %v", p, addErr)
		}
		return nil
	})
	if err != nil {
		log.Printf("[WARN] watch tree %s: %v", dir, err)
	}
}

func opOf(op fsnotify.Op) Op {
	var res Op
	if op.Has(fsnotify.Create) {
		res |= OpCreate
	}
	if op.Has(fsnotify.Write) {
		res |= OpWrite
	}
	if op.Has(fsnotify.Remove) {
		res |= OpRemove
	}
	if op.Has(fsnotify.Rename) {
		res |= OpRename
	}
	if res == 0 {
		res = OpWrite
	}
	return res
}
