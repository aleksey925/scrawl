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

// WatchMode picks the change source behind Watch.
type WatchMode string

const (
	// WatchAuto watches with inotify plus a periodic rescan, and degrades to
	// polling when the kernel runs out of watches. It is the default.
	WatchAuto WatchMode = "auto"
	// WatchPoll only rescans. Pick it for a knowledge base on a network share,
	// where inotify never reports another client's writes, or on a host whose
	// inotify budget is already spent.
	WatchPoll WatchMode = "poll"
)

// Op is the kind of change reported by Watch. One event can carry several
// flags, because a debounced batch merges everything that happened to a path.
//
// Treat OpCreate and OpWrite the same. An atomic save replaces the inode, so
// every save from the editor and every save over SMB arrives as a create, and
// a consumer that only listens for OpWrite sees nothing at all.
type Op uint8

// The change kinds Watch reports. A bare chmod is dropped: on Linux it also
// fires on unlink and never means the content changed.
const (
	OpCreate Op = 1 << iota
	OpWrite
	OpRemove
	OpRename
)

// Has reports whether o contains other.
func (o Op) Has(other Op) bool { return o&other != 0 }

// String implements fmt.Stringer.
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

// Event reports a change under the root. Path has the same shape as every
// other path in the API: relative to the root, slash-separated.
type Event struct {
	Path string
	Op   Op
}

// Watcher is the change source behind Store.Watch. Run reports changes into
// out until ctx is canceled and then returns true. It returns false when it
// gave up for a reason another watcher can survive - the kernel running out of
// inotify watches is the one that happens for real - and Store.Watch then
// hands over to the next watcher in the chain.
type Watcher interface {
	Run(ctx context.Context, out chan<- Event) bool
	Name() string
}

// Watch reports changes under the root until ctx is canceled, then closes the
// channel. Events are debounced by Config.Debounce and a rescan every
// Config.Rescan catches whatever inotify missed.
//
// The watches and the baseline snapshot are in place before Watch returns, so
// a change made right after the call cannot slip through the gap between the
// call and the goroutine starting.
func (s *Store) Watch(ctx context.Context) <-chan Event {
	out := make(chan Event, eventBuffer)
	chain := s.watchers()
	go func() {
		defer close(out)
		runWatchers(ctx, out, chain...)
	}()
	return out
}

// watchers builds the chain for the configured mode. Both watchers share one
// tracker, so the baseline survives a handover from inotify to polling.
func (s *Store) watchers() []Watcher {
	tr := &tracker{store: s, pending: map[string]Op{}}
	tr.seen = tr.snapshot()
	if s.cfg.Watch == WatchPoll {
		return []Watcher{&pollWatcher{tracker: tr}}
	}
	return []Watcher{newFsWatcher(tr), &pollWatcher{tracker: tr}}
}

// runWatchers runs the chain until one of them finishes on its own terms.
func runWatchers(ctx context.Context, out chan<- Event, chain ...Watcher) {
	for _, w := range chain {
		log.Printf("[DEBUG] change source: %s watcher", w.Name())
		if w.Run(ctx, out) {
			return
		}
	}
}

// tracker is the machinery both watchers share: it turns paths into store
// events, merges them into a batch and hands the batch to the consumer.
type tracker struct {
	store   *Store
	pending map[string]Op
	seen    map[string]fingerprint
}

// fingerprint is what a rescan compares to spot a change without inotify.
type fingerprint struct {
	size  int64
	mtime int64
	isDir bool
}

func (t *tracker) mark(rel string, op Op) {
	t.pending[rel] |= op
	t.store.invalidate()
}

// rel maps an absolute path to a store path, dropping whatever the rest of the
// app cannot see anyway.
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

// markTree marks everything inside a directory that appeared as a whole. This
// is not an optimisation: when a folder is copied in, its files are already
// there by the time the create event for the folder arrives, so watching the
// new directory finds nothing and only this walk reports the content.
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

// rescan diffs a fresh snapshot against the previous one and marks whatever
// moved. It reports whether anything did.
func (t *tracker) rescan() bool {
	current := t.snapshot()
	changed := false

	for p, fp := range current {
		// the mtime of a directory moves whenever an entry inside it appears,
		// which the entry's own event already covers
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

// pollWatcher only compares snapshots. It is right everywhere, including on a
// network share, and merely slower than inotify.
type pollWatcher struct{ *tracker }

// Name implements Watcher.
func (w *pollWatcher) Name() string { return "poll" }

// Run implements Watcher.
func (w *pollWatcher) Run(ctx context.Context, out chan<- Event) bool {
	interval := w.store.cfg.Rescan
	if interval <= 0 {
		interval = defaultRescan // polling with no interval would report nothing at all
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

// fsWatcher reports changes through inotify, with the rescan still running as
// a second opinion.
type fsWatcher struct {
	*tracker
	fsw       *fsnotify.Watcher
	exhausted bool // the kernel ran out of inotify watches
}

// newFsWatcher registers the watches right away, so nothing is missed between
// Watch returning and its goroutine reaching the event loop. A watcher that
// could not start has no fsnotify handle and gives up on the first Run.
func newFsWatcher(tr *tracker) *fsWatcher {
	w := &fsWatcher{tracker: tr}

	// a buffered watcher gives the kernel room during a bulk change (an rsync,
	// a Synology Drive sync), so the inotify queue does not overflow and drop
	// events silently
	fsw, err := fsnotify.NewBufferedWatcher(inotifyBuffer)
	if err != nil {
		log.Printf("[WARN] inotify is not available: %v", err)
		return w
	}
	w.fsw = fsw
	w.addTree(w.store.dir)
	return w
}

// Name implements Watcher.
func (w *fsWatcher) Name() string { return "fsnotify" }

// Run implements Watcher.
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
			w.addTree(w.store.dir) // pick up directories inotify never told us about
			if changed {
				w.flush(ctx, out)
			}
			if w.exhausted {
				return false
			}
		}
	}
}

// handle turns one raw event into a pending change and reports whether the
// debounce timer has to be restarted, so a stream of noise cannot hold a batch
// back forever.
func (w *fsWatcher) handle(ev fsnotify.Event) bool {
	if ev.Op == fsnotify.Chmod {
		return false
	}
	rel, ok := w.rel(ev.Name)
	if !ok {
		return false
	}

	// a new directory needs its own watch, and a copied-in folder already holds
	// its files by the time this arrives, so walk it instead of only adding it
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

// addTree watches dir and every directory below it. inotify is not recursive,
// so this runs again for every directory that shows up later.
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
				// DSM pins fs.inotify.max_user_watches to 8192 for the whole
				// host and resets it on every boot, so a big tree really does
				// run out. Polling is slower but still right.
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
