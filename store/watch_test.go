package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// waitEvent drains the channel until the wanted path shows up and returns
// everything seen on the way, so a test can also assert what did not arrive.
func waitEvent(t *testing.T, events <-chan Event, want string) (Op, []Event) {
	t.Helper()

	seen := []Event{}
	deadline := time.After(5 * time.Second)
	for {
		select {
		case ev, ok := <-events:
			require.True(t, ok, "channel closed before %q arrived, seen %v", want, seen)
			seen = append(seen, ev)
			if ev.Path == want {
				return ev.Op, seen
			}
		case <-deadline:
			t.Fatalf("timed out waiting for %q, seen %v", want, seen)
		}
	}
}

func assertClosed(t *testing.T, events <-chan Event) {
	t.Helper()

	deadline := time.After(5 * time.Second)
	for {
		select {
		case _, ok := <-events:
			if !ok {
				return
			}
		case <-deadline:
			t.Fatal("the event channel was not closed after the context was canceled")
		}
	}
}

func fastWatch(c *Config) {
	c.Debounce = 20 * time.Millisecond
	c.Rescan = 100 * time.Millisecond
}

func TestStoreWatch(t *testing.T) {
	t.Run("reports a change and shuts down cleanly", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles(), fastWatch)
		ctx, cancel := context.WithCancel(t.Context())
		events := s.Watch(ctx)

		// act
		require.NoError(t, os.WriteFile(filepath.Join(s.Dir(), "fresh.md"), []byte("# fresh\n"), 0o644))

		// assert
		op, _ := waitEvent(t, events, "fresh.md")
		assert.True(t, op.Has(OpCreate|OpWrite), "got %s", op)

		cancel()
		assertClosed(t, events)
	})

	t.Run("ignored paths are never reported", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles(), fastWatch)
		events := s.Watch(t.Context())

		// act
		require.NoError(t, os.WriteFile(filepath.Join(s.Dir(), ".hidden.md"), []byte("x"), 0o644))
		require.NoError(t, os.WriteFile(filepath.Join(s.Dir(), "node_modules", "pkg", "extra.md"), []byte("x"), 0o644))
		require.NoError(t, os.WriteFile(filepath.Join(s.Dir(), "marker.md"), []byte("x"), 0o644))

		// assert
		_, seen := waitEvent(t, events, "marker.md")
		for _, ev := range seen {
			assert.Equal(t, "marker.md", ev.Path)
		}
	})

	t.Run("an atomic save is reported", func(t *testing.T) {
		// arrange: no rescan, so only the inotify path can deliver this
		s := newStore(t, notesFiles(), func(c *Config) {
			c.Debounce = 20 * time.Millisecond
			c.Rescan = -1
		})
		events := s.Watch(t.Context())
		data, _, err := s.Read("guide.md")
		require.NoError(t, err)

		// act
		_, err = s.Write("guide.md", []byte("saved from the editor\n"), Rev(data))
		require.NoError(t, err)

		// assert
		op, _ := waitEvent(t, events, "guide.md")
		assert.True(t, op.Has(OpCreate|OpWrite), "a rename-based save must not be dropped, got %s", op)
	})

	t.Run("a folder copied in reports its content", func(t *testing.T) {
		// arrange: the files exist before the directory appears in the root,
		// which is what a copy over SMB looks like
		s := newStore(t, notesFiles(), func(c *Config) {
			c.Debounce = 20 * time.Millisecond
			c.Rescan = -1
		})
		events := s.Watch(t.Context())

		staging := filepath.Join(t.TempDir(), "incoming")
		require.NoError(t, os.MkdirAll(filepath.Join(staging, "sub"), 0o755))
		require.NoError(t, os.MkdirAll(filepath.Join(staging, ".git"), 0o755))
		require.NoError(t, os.WriteFile(filepath.Join(staging, "one.md"), []byte("1"), 0o644))
		require.NoError(t, os.WriteFile(filepath.Join(staging, "sub", "two.md"), []byte("2"), 0o644))
		require.NoError(t, os.WriteFile(filepath.Join(staging, ".git", "config"), []byte("x"), 0o644))

		// act
		require.NoError(t, os.Rename(staging, filepath.Join(s.Dir(), "incoming")))

		// assert
		op, seen := waitEvent(t, events, "incoming/sub/two.md")
		assert.True(t, op.Has(OpCreate), "got %s", op)

		paths := map[string]bool{}
		for _, ev := range seen {
			paths[ev.Path] = true
			assert.NotContains(t, ev.Path, ".git")
		}
		assert.True(t, paths["incoming/one.md"], "seen %v", seen)
	})

	t.Run("poll mode reports a change", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles(), func(c *Config) {
			c.Watch = WatchPoll
			c.Rescan = 50 * time.Millisecond
		})
		ctx, cancel := context.WithCancel(t.Context())
		events := s.Watch(ctx)

		// act
		require.NoError(t, os.WriteFile(filepath.Join(s.Dir(), "polled.md"), []byte("x"), 0o644))

		// assert
		op, _ := waitEvent(t, events, "polled.md")
		assert.Equal(t, OpCreate, op)

		cancel()
		assertClosed(t, events)
	})
}

func TestStoreWatchers(t *testing.T) {
	tests := []struct {
		name string
		mode WatchMode
		want []string
	}{
		{name: "auto degrades to poll", mode: WatchAuto, want: []string{"fsnotify", "poll"}},
		{name: "poll only", mode: WatchPoll, want: []string{"poll"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := newStore(t, notesFiles(), func(c *Config) { c.Watch = tc.mode })

			got := []string{}
			for _, w := range s.watchers() {
				got = append(got, w.Name())
				if fsw, ok := w.(*fsWatcher); ok && fsw.fsw != nil {
					require.NoError(t, fsw.fsw.Close())
				}
			}
			assert.Equal(t, tc.want, got)
		})
	}
}

// stubWatcher stands in for a watcher that gives up, which is what the real
// fsnotify one does when the kernel runs out of inotify watches.
type stubWatcher struct {
	name  string
	emit  Event
	ok    bool
	calls *[]string
}

func (w *stubWatcher) Name() string { return w.name }

func (w *stubWatcher) Run(ctx context.Context, out chan<- Event) bool {
	*w.calls = append(*w.calls, w.name)
	select {
	case out <- w.emit:
	case <-ctx.Done():
	}
	return w.ok
}

func TestRunWatchers(t *testing.T) {
	// arrange
	calls := []string{}
	out := make(chan Event, 4)
	first := &stubWatcher{name: "first", emit: Event{Path: "a.md", Op: OpWrite}, calls: &calls}
	second := &stubWatcher{name: "second", emit: Event{Path: "b.md", Op: OpCreate}, ok: true, calls: &calls}

	// act
	runWatchers(t.Context(), out, first, second)
	close(out)

	// assert
	got := []Event{}
	for ev := range out {
		got = append(got, ev)
	}
	assert.Equal(t, []string{"first", "second"}, calls)
	assert.Equal(t, []Event{{Path: "a.md", Op: OpWrite}, {Path: "b.md", Op: OpCreate}}, got)
}

func TestTrackerRescan(t *testing.T) {
	// arrange
	s := newStore(t, notesFiles())
	tr := &tracker{store: s, pending: map[string]Op{}}
	tr.seen = tr.snapshot()

	require.NoError(t, os.WriteFile(filepath.Join(s.Dir(), "added.md"), []byte("x"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(s.Dir(), "guide.md"), []byte("changed"), 0o644))
	require.NoError(t, os.Remove(filepath.Join(s.Dir(), "index.md")))
	require.NoError(t, os.WriteFile(filepath.Join(s.Dir(), ".ignored.md"), []byte("x"), 0o644))

	// act
	changed := tr.rescan()
	out := make(chan Event, 16)
	tr.flush(t.Context(), out)
	close(out)

	// assert
	got := map[string]Op{}
	for ev := range out {
		got[ev.Path] = ev.Op
	}
	assert.True(t, changed)
	assert.Equal(t, map[string]Op{"added.md": OpCreate, "guide.md": OpWrite, "index.md": OpRemove}, got)
	assert.False(t, tr.rescan(), "a second rescan with nothing new reports no change")
}

func TestOpOf(t *testing.T) {
	tests := []struct {
		name string
		op   fsnotify.Op
		want Op
	}{
		{name: "create", op: fsnotify.Create, want: OpCreate},
		{name: "write", op: fsnotify.Write, want: OpWrite},
		{name: "remove", op: fsnotify.Remove, want: OpRemove},
		{name: "rename", op: fsnotify.Rename, want: OpRename},
		{name: "merged", op: fsnotify.Create | fsnotify.Write, want: OpCreate | OpWrite},
		{name: "chmod alone counts as a write", op: fsnotify.Chmod, want: OpWrite},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, opOf(tc.op))
		})
	}
}

func TestTrackerRel(t *testing.T) {
	s := newStore(t, notesFiles())
	tr := &tracker{store: s, pending: map[string]Op{}}

	tests := []struct {
		name string
		abs  string
		want string
		ok   bool
	}{
		{name: "file", abs: filepath.Join(s.Dir(), "notes", "index.md"), want: "notes/index.md", ok: true},
		{name: "the root itself", abs: s.Dir()},
		{name: "outside the root", abs: filepath.Join(filepath.Dir(s.Dir()), secretName)},
		{name: "hidden", abs: filepath.Join(s.Dir(), ".git", "config")},
		{name: "temp file", abs: filepath.Join(s.Dir(), "a.md.a1b2c3"+tmpSuffix)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := tr.rel(tc.abs)
			assert.Equal(t, tc.ok, ok)
			assert.Equal(t, tc.want, got)
		})
	}
}
