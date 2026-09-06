package store

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"testing/iotest"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	secretName = "secret.txt"
	secretBody = "top secret\n"
)

var (
	pngData  = append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 16)...)
	gifData  = append([]byte("GIF89a"), make([]byte, 16)...)
	jpegData = append([]byte{0xff, 0xd8, 0xff}, make([]byte, 16)...)
	webpData = []byte("RIFF\x00\x00\x00\x00WEBPVP8 ")
	pdfData  = []byte("%PDF-1.7\n%%EOF\n")
	svgData  = []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`)
	svgXML   = []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>`)
	scriptSh = []byte("#!/bin/sh\nrm -rf /\n")
)

func kbFiles() map[string]string {
	return map[string]string{
		"index.md":                   "# root\n",
		"guide.md":                   "# guide\ntrailing   \nno newline at the end",
		"snippet.py":                 "print(1)\n",
		"images/logo.png":            string(pngData),
		"notes/index.md":             "# notes\n",
		"notes/Cyrillic.md":          "# Заметка\nтекст\n",
		"notes/deep/nested.md":       "# nested\n",
		"notes/.hidden.md":           "# hidden\n",
		".git/config":                "[core]\n",
		"node_modules/pkg/readme.md": "# vendored\n",
		"__pycache__/cache.md":       "# cached\n",
	}
}

// makeTree builds a knowledge base in a temp directory and plants a secret
// next to it, so a traversal that works is visible in the assertion. A key
// ending with a slash makes an empty directory.
func makeTree(t *testing.T, files map[string]string) string {
	t.Helper()

	base := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(base, secretName), []byte(secretBody), 0o600))

	root := filepath.Join(base, "kb")
	require.NoError(t, os.MkdirAll(root, 0o755))
	for p, content := range files {
		full := filepath.Join(root, filepath.FromSlash(p))
		if strings.HasSuffix(p, "/") {
			require.NoError(t, os.MkdirAll(full, 0o755))
			continue
		}
		require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o755))
		require.NoError(t, os.WriteFile(full, []byte(content), 0o644))
	}
	return root
}

func newStore(t *testing.T, files map[string]string, opts ...func(*Config)) *Store {
	t.Helper()

	cfg := Config{Root: makeTree(t, files)}
	for _, opt := range opts {
		opt(&cfg)
	}
	s, err := New(cfg)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, s.Close()) })
	return s
}

func names(entries []FileInfo) []string {
	res := make([]string, 0, len(entries))
	for _, fi := range entries {
		res = append(res, fi.Name)
	}
	return res
}

func flatten(n *Node) []string {
	res := []string{}
	for _, sub := range n.Children {
		res = append(res, sub.Path)
		res = append(res, flatten(sub)...)
	}
	return res
}

func tempFiles(t *testing.T, root string) []string {
	t.Helper()

	res := []string{}
	require.NoError(t, filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		require.NoError(t, err)
		if !d.IsDir() && strings.HasSuffix(d.Name(), tmpSuffix) {
			res = append(res, p)
		}
		return nil
	}))
	return res
}

func TestNew(t *testing.T) {
	t.Run("root is a file", func(t *testing.T) {
		_, err := New(Config{Root: filepath.Join(makeTree(t, kbFiles()), "guide.md")})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not a directory")
	})

	t.Run("root is missing", func(t *testing.T) {
		_, err := New(Config{Root: filepath.Join(t.TempDir(), "nope")})
		require.ErrorIs(t, err, fs.ErrNotExist)
	})

	t.Run("broken exclude glob", func(t *testing.T) {
		_, err := New(Config{Root: makeTree(t, nil), Exclude: []string{"[bad"}})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "exclude glob")
	})

	t.Run("leftover temp files are swept", func(t *testing.T) {
		root := makeTree(t, kbFiles())
		leftover := filepath.Join(root, "notes", "index.md.a1b2c3"+tmpSuffix)
		require.NoError(t, os.WriteFile(leftover, []byte("junk"), 0o644))

		s, err := New(Config{Root: root})
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, s.Close()) })

		assert.NoFileExists(t, leftover)
		assert.FileExists(t, filepath.Join(root, "notes", "index.md"))
	})
}

func TestWithDefaults(t *testing.T) {
	tests := []struct {
		name string
		cfg  Config
		want Config
	}{
		{
			name: "zero config",
			cfg:  Config{},
			want: Config{Watch: WatchAuto, TreeTTL: defaultTreeTTL, Debounce: defaultDebounce, Rescan: defaultRescan},
		},
		{
			name: "explicit values are kept",
			cfg:  Config{Watch: WatchPoll, TreeTTL: time.Second, Debounce: 2 * time.Second, Rescan: 3 * time.Second},
			want: Config{Watch: WatchPoll, TreeTTL: time.Second, Debounce: 2 * time.Second, Rescan: 3 * time.Second},
		},
		{
			name: "negative rescan disables it",
			cfg:  Config{Rescan: -1},
			want: Config{Watch: WatchAuto, TreeTTL: defaultTreeTTL, Debounce: defaultDebounce, Rescan: -1},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, withDefaults(tc.cfg))
		})
	}
}

func TestCleanPath(t *testing.T) {
	tests := []struct {
		name string
		path string
		want string
		err  error
	}{
		{name: "empty is the root", path: "", want: "."},
		{name: "dot is the root", path: ".", want: "."},
		{name: "slash is the root", path: "/", want: "."},
		{name: "plain file", path: "a/b.md", want: "a/b.md"},
		{name: "leading slash dropped", path: "/a/b.md", want: "a/b.md"},
		{name: "trailing slash dropped", path: "a/b/", want: "a/b"},
		{name: "dot segment", path: "./a/b.md", want: "a/b.md"},
		{name: "dot dot inside the root", path: "a/../a/b.md", want: "a/b.md"},
		{name: "parent", path: "../" + secretName, err: ErrForbidden},
		{name: "bare parent", path: "..", err: ErrForbidden},
		{name: "climbing out of a subdirectory", path: "a/../../" + secretName, err: ErrForbidden},
		{name: "deeply nested climb", path: "a/b/c/../../../../../etc/passwd", err: ErrForbidden},
		{name: "double leading slash", path: "//etc/passwd", err: ErrForbidden},
		{name: "nul byte", path: "a\x00b.md", err: ErrForbidden},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := cleanPath(tc.path)
			if tc.err != nil {
				require.ErrorIs(t, err, tc.err)
				assert.Empty(t, got)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestStoreTraversal(t *testing.T) {
	s := newStore(t, kbFiles())

	tests := []struct {
		name string
		path string
		err  error
	}{
		{name: "parent", path: "../" + secretName, err: ErrForbidden},
		{name: "parent with a leading slash", path: "/../" + secretName, err: ErrForbidden},
		{name: "climb out of a subdirectory", path: "notes/../../" + secretName, err: ErrForbidden},
		{name: "deeply nested climb", path: "notes/deep/../../../../../etc/passwd", err: ErrForbidden},
		{name: "bare parent", path: "..", err: ErrForbidden},
		{name: "absolute path stays inside", path: "/etc/passwd", err: ErrNotFound},
		{name: "percent encoded parent is a plain name", path: "..%2f" + secretName, err: ErrNotFound},
		{name: "backslash is a plain name", path: `..\` + secretName, err: ErrNotFound},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			data, _, readErr := s.Read(tc.path)
			_, statErr := s.Stat(tc.path)
			_, listErr := s.List(tc.path)

			// assert
			require.ErrorIs(t, readErr, tc.err)
			require.ErrorIs(t, statErr, tc.err)
			require.ErrorIs(t, listErr, tc.err)
			assert.NotContains(t, string(data), secretBody)
			assert.False(t, s.Exists(tc.path))
		})
	}

	t.Run("dot dot inside the root is legal", func(t *testing.T) {
		data, fi, err := s.Read("notes/../guide.md")
		require.NoError(t, err)
		assert.Equal(t, kbFiles()["guide.md"], string(data))
		assert.Equal(t, "guide.md", fi.Path)
	})
}

func TestStoreSymlinks(t *testing.T) {
	s := newStore(t, kbFiles())
	root := s.Dir()
	outside := filepath.Join(filepath.Dir(root), secretName)

	require.NoError(t, os.Symlink(outside, filepath.Join(root, "absolute.md")))
	require.NoError(t, os.Symlink("../"+secretName, filepath.Join(root, "climb.md")))
	require.NoError(t, os.Symlink("guide.md", filepath.Join(root, "inside.md")))
	require.NoError(t, os.Symlink(".git", filepath.Join(root, "sneaky")))

	tests := []struct {
		name string
		path string
	}{
		{name: "absolute link out of the root", path: "absolute.md"},
		{name: "relative link out of the root", path: "climb.md"},
		{name: "link inside the root", path: "inside.md"},
		{name: "link to an ignored directory", path: "sneaky/config"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			data, _, readErr := s.Read(tc.path)
			_, statErr := s.Stat(tc.path)

			// assert
			require.ErrorIs(t, readErr, ErrNotFound)
			require.ErrorIs(t, statErr, ErrNotFound)
			assert.Empty(t, data)
			assert.False(t, s.Exists(tc.path))
		})
	}

	t.Run("links are not listed", func(t *testing.T) {
		entries, err := s.List("")
		require.NoError(t, err)
		assert.Equal(t, []string{"images", "notes", "guide.md", "index.md", "snippet.py"}, names(entries))
	})

	t.Run("os.Root refuses an escaping link on its own", func(t *testing.T) {
		// arrange
		raw, err := os.OpenRoot(root)
		require.NoError(t, err)
		defer raw.Close()

		// act & assert
		for _, link := range []string{"absolute.md", "climb.md"} {
			_, readErr := raw.ReadFile(link)
			require.Error(t, readErr)
			assert.ErrorContains(t, readErr, "escapes from parent")
			assert.False(t, errors.Is(readErr, fs.ErrNotExist), "the escape error is not ErrNotExist")
		}

		// a link that stays inside is followed by os.Root, which is why the
		// store filters symlinks itself instead of relying on the escape check
		data, err := raw.ReadFile("inside.md")
		require.NoError(t, err)
		assert.Equal(t, kbFiles()["guide.md"], string(data))
	})
}

func TestStoreIgnored(t *testing.T) {
	files := kbFiles()
	files["draft.private"] = "hidden by a glob\n"
	files["secrets/keys.md"] = "hidden by a glob\n"
	files["notes/index.md.a1b2c3"+tmpSuffix] = "leftover\n"
	s := newStore(t, files, func(c *Config) { c.Exclude = []string{"*.private", "secrets"} })

	hidden := []string{
		".git", ".git/config",
		"node_modules", "node_modules/pkg/readme.md",
		"__pycache__/cache.md",
		"notes/.hidden.md",
		"draft.private",
		"secrets", "secrets/keys.md",
		"notes/index.md.a1b2c3" + tmpSuffix,
	}
	for _, p := range hidden {
		t.Run(p, func(t *testing.T) {
			// act
			data, _, readErr := s.Read(p)
			_, statErr := s.Stat(p)
			_, _, openErr := s.Open(p)
			_, listErr := s.List(p)
			_, writeErr := s.Write(p, []byte("x"), "")

			// assert
			require.ErrorIs(t, readErr, ErrNotFound)
			require.ErrorIs(t, statErr, ErrNotFound)
			require.ErrorIs(t, openErr, ErrNotFound)
			require.ErrorIs(t, listErr, ErrNotFound)
			require.ErrorIs(t, writeErr, ErrNotFound)
			assert.Empty(t, data)
			assert.False(t, s.Exists(p))
		})
	}

	t.Run("not in the tree", func(t *testing.T) {
		tree, err := s.Tree()
		require.NoError(t, err)
		assert.Equal(t, []string{
			"images", "images/logo.png",
			"notes", "notes/deep", "notes/deep/nested.md", "notes/Cyrillic.md", "notes/index.md",
			"guide.md", "index.md", "snippet.py",
		}, flatten(tree))
	})

	t.Run("not walked", func(t *testing.T) {
		visited := []string{}
		require.NoError(t, s.Walk(func(fi FileInfo, _ []byte) error {
			visited = append(visited, fi.Path)
			return nil
		}))
		assert.Equal(t, []string{
			"guide.md", "index.md", "notes/Cyrillic.md", "notes/deep/nested.md", "notes/index.md",
		}, visited)
	})
}

func TestStoreList(t *testing.T) {
	s := newStore(t, kbFiles())

	t.Run("root, directories first", func(t *testing.T) {
		entries, err := s.List("")
		require.NoError(t, err)
		assert.Equal(t, []string{"images", "notes", "guide.md", "index.md", "snippet.py"}, names(entries))
	})

	t.Run("case insensitive order", func(t *testing.T) {
		entries, err := s.List("notes")
		require.NoError(t, err)
		assert.Equal(t, []string{"deep", "Cyrillic.md", "index.md"}, names(entries))
	})

	t.Run("entry fields", func(t *testing.T) {
		entries, err := s.List("notes")
		require.NoError(t, err)
		require.Len(t, entries, 3)

		file := entries[2]
		assert.Equal(t, "notes/index.md", file.Path)
		assert.Equal(t, "index.md", file.Name)
		assert.False(t, file.IsDir)
		assert.Equal(t, int64(len(kbFiles()["notes/index.md"])), file.Size)
		assert.WithinDuration(t, time.Now(), file.ModTime, time.Minute)
		assert.True(t, entries[0].IsDir)
	})

	tests := []struct {
		name string
		dir  string
		err  error
	}{
		{name: "missing directory", dir: "nope", err: ErrNotFound},
		{name: "a file is not a directory", dir: "guide.md", err: ErrNotFound},
		{name: "ignored directory", dir: ".git", err: ErrNotFound},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			entries, err := s.List(tc.dir)
			require.ErrorIs(t, err, tc.err)
			assert.Empty(t, entries)
		})
	}
}

func TestStoreStat(t *testing.T) {
	s := newStore(t, kbFiles())

	t.Run("root", func(t *testing.T) {
		fi, err := s.Stat("")
		require.NoError(t, err)
		assert.Equal(t, "", fi.Path)
		assert.Equal(t, "", fi.Name)
		assert.True(t, fi.IsDir)
	})

	t.Run("file", func(t *testing.T) {
		fi, err := s.Stat("notes/deep/nested.md")
		require.NoError(t, err)
		assert.Equal(t, "notes/deep/nested.md", fi.Path)
		assert.Equal(t, "nested.md", fi.Name)
		assert.False(t, fi.IsDir)
		assert.Equal(t, int64(len(kbFiles()["notes/deep/nested.md"])), fi.Size)
	})

	t.Run("missing", func(t *testing.T) {
		_, err := s.Stat("nope.md")
		require.ErrorIs(t, err, ErrNotFound)
	})
}

func TestStoreReadOpen(t *testing.T) {
	s := newStore(t, kbFiles())

	t.Run("content is returned byte for byte", func(t *testing.T) {
		data, fi, err := s.Read("guide.md")
		require.NoError(t, err)
		assert.Equal(t, kbFiles()["guide.md"], string(data))
		assert.Equal(t, int64(len(data)), fi.Size)
	})

	t.Run("open seeks", func(t *testing.T) {
		f, fi, err := s.Open("guide.md")
		require.NoError(t, err)
		defer f.Close()

		_, err = f.Seek(2, io.SeekStart)
		require.NoError(t, err)
		rest, err := io.ReadAll(f)
		require.NoError(t, err)
		assert.Equal(t, kbFiles()["guide.md"][2:], string(rest))
		assert.Equal(t, "guide.md", fi.Path)
	})

	t.Run("a directory is not readable", func(t *testing.T) {
		_, _, err := s.Read("notes")
		require.ErrorIs(t, err, ErrIsDir)
		_, _, err = s.Open("notes")
		require.ErrorIs(t, err, ErrIsDir)
	})

	t.Run("missing file", func(t *testing.T) {
		_, _, err := s.Read("nope.md")
		require.ErrorIs(t, err, ErrNotFound)
	})
}

func TestStoreWrite(t *testing.T) {
	t.Run("create with an empty revision", func(t *testing.T) {
		s := newStore(t, kbFiles())

		fi, err := s.Write("new/dir/page.md", []byte("# new\n"), "")
		require.NoError(t, err)
		assert.Equal(t, "new/dir/page.md", fi.Path)

		data, _, err := s.Read("new/dir/page.md")
		require.NoError(t, err)
		assert.Equal(t, "# new\n", string(data))
	})

	t.Run("create over an existing file", func(t *testing.T) {
		s := newStore(t, kbFiles())
		_, err := s.Write("guide.md", []byte("x"), "")
		require.ErrorIs(t, err, ErrExists)

		data, _, err := s.Read("guide.md")
		require.NoError(t, err)
		assert.Equal(t, kbFiles()["guide.md"], string(data))
	})

	t.Run("update with the matching revision", func(t *testing.T) {
		s := newStore(t, kbFiles())
		data, _, err := s.Read("guide.md")
		require.NoError(t, err)

		updated := "# guide\nchanged   "
		fi, err := s.Write("guide.md", []byte(updated), Rev(data))
		require.NoError(t, err)
		assert.Equal(t, int64(len(updated)), fi.Size)

		got, _, err := s.Read("guide.md")
		require.NoError(t, err)
		assert.Equal(t, updated, string(got))
	})

	t.Run("update with a stale revision", func(t *testing.T) {
		s := newStore(t, kbFiles())
		data, _, err := s.Read("guide.md")
		require.NoError(t, err)
		_, err = s.Write("guide.md", []byte("from another tab\n"), Rev(data))
		require.NoError(t, err)

		// act
		_, err = s.Write("guide.md", []byte("stale\n"), Rev(data))

		// assert
		require.ErrorIs(t, err, ErrConflict)
		var conflict *ConflictError
		require.ErrorAs(t, err, &conflict)
		assert.Equal(t, "guide.md", conflict.Path)
		assert.Equal(t, "from another tab\n", string(conflict.Current))
		assert.Equal(t, Rev([]byte("from another tab\n")), conflict.CurrentRev)
	})

	t.Run("update of a file removed under us", func(t *testing.T) {
		s := newStore(t, kbFiles())
		data, _, err := s.Read("guide.md")
		require.NoError(t, err)
		require.NoError(t, s.Remove("guide.md"))

		_, err = s.Write("guide.md", []byte("x"), Rev(data))
		require.ErrorIs(t, err, ErrConflict)
		var conflict *ConflictError
		require.ErrorAs(t, err, &conflict)
		assert.Empty(t, conflict.CurrentRev)
		assert.Empty(t, conflict.Current)
	})

	t.Run("a directory is not writable", func(t *testing.T) {
		s := newStore(t, kbFiles())
		_, err := s.Write("notes", []byte("x"), "")
		require.ErrorIs(t, err, ErrIsDir)
		_, err = s.Write("", []byte("x"), "")
		require.ErrorIs(t, err, ErrIsDir)
	})

	t.Run("the mode of an existing file is preserved", func(t *testing.T) {
		s := newStore(t, kbFiles())
		target := filepath.Join(s.Dir(), "guide.md")
		require.NoError(t, os.Chmod(target, 0o640))

		data, _, err := s.Read("guide.md")
		require.NoError(t, err)
		_, err = s.Write("guide.md", []byte("changed\n"), Rev(data))
		require.NoError(t, err)

		fi, err := os.Stat(target)
		require.NoError(t, err)
		assert.Equal(t, fs.FileMode(0o640), fi.Mode().Perm())
	})

	t.Run("no temp file is left behind", func(t *testing.T) {
		s := newStore(t, kbFiles())
		_, err := s.Write("fresh.md", []byte("x"), "")
		require.NoError(t, err)
		assert.Empty(t, tempFiles(t, s.Dir()))
	})

	t.Run("a failed write leaves no temp file", func(t *testing.T) {
		// arrange: renaming a file over a directory that has entries always fails
		s := newStore(t, kbFiles())

		// act
		err := s.writeAtomic("notes", []byte("x"))

		// assert
		require.Error(t, err)
		assert.Empty(t, tempFiles(t, s.Dir()))
		entries, err := s.List("notes")
		require.NoError(t, err)
		assert.Equal(t, []string{"deep", "Cyrillic.md", "index.md"}, names(entries))
	})
}

func TestStoreWriteConcurrent(t *testing.T) {
	// arrange
	s := newStore(t, kbFiles())
	data, _, err := s.Read("guide.md")
	require.NoError(t, err)
	rev := Rev(data)

	const workers = 8
	results := make([]error, workers)
	var wg sync.WaitGroup

	// act
	for i := range workers {
		wg.Go(func() {
			_, results[i] = s.Write("guide.md", fmt.Appendf(nil, "written by %d\n", i), rev)
		})
	}
	wg.Wait()

	// assert
	winners := 0
	for _, res := range results {
		if res == nil {
			winners++
			continue
		}
		require.ErrorIs(t, res, ErrConflict)
	}
	assert.Equal(t, 1, winners, "exactly one writer wins, the rest get a conflict")
}

func TestStoreCreate(t *testing.T) {
	t.Run("file with missing parents", func(t *testing.T) {
		s := newStore(t, kbFiles())
		fi, err := s.Create("a/b/c.md", false)
		require.NoError(t, err)
		assert.Equal(t, FileInfo{Path: "a/b/c.md", Name: "c.md", ModTime: fi.ModTime}, fi)

		data, _, err := s.Read("a/b/c.md")
		require.NoError(t, err)
		assert.Empty(t, data)
	})

	t.Run("directory", func(t *testing.T) {
		s := newStore(t, kbFiles())
		fi, err := s.Create("a/b", true)
		require.NoError(t, err)
		assert.True(t, fi.IsDir)

		entries, err := s.List("a")
		require.NoError(t, err)
		assert.Equal(t, []string{"b"}, names(entries))
	})

	tests := []struct {
		name string
		path string
		err  error
	}{
		{name: "existing file", path: "guide.md", err: ErrExists},
		{name: "existing directory", path: "notes", err: ErrExists},
		{name: "the root itself", path: "", err: ErrExists},
		{name: "ignored path", path: ".git/hooks", err: ErrNotFound},
		{name: "outside the root", path: "../" + secretName, err: ErrForbidden},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := newStore(t, kbFiles())
			_, err := s.Create(tc.path, false)
			require.ErrorIs(t, err, tc.err)
		})
	}
}

func TestStoreRemove(t *testing.T) {
	tests := []struct {
		name string
		path string
		err  error
	}{
		{name: "file", path: "guide.md"},
		{name: "empty directory", path: "empty"},
		{name: "non-empty directory", path: "notes", err: ErrNotEmpty},
		{name: "missing", path: "nope.md", err: ErrNotFound},
		{name: "ignored", path: ".git/config", err: ErrNotFound},
		{name: "the root itself", path: "", err: ErrForbidden},
		{name: "outside the root", path: "../" + secretName, err: ErrForbidden},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			files := kbFiles()
			files["empty/"] = ""
			s := newStore(t, files)

			// act
			err := s.Remove(tc.path)

			// assert
			if tc.err != nil {
				require.ErrorIs(t, err, tc.err)
				return
			}
			require.NoError(t, err)
			assert.False(t, s.Exists(tc.path))
		})
	}

	t.Run("the secret next to the root survives", func(t *testing.T) {
		s := newStore(t, kbFiles())
		require.Error(t, s.Remove("../"+secretName))
		assert.FileExists(t, filepath.Join(filepath.Dir(s.Dir()), secretName))
	})
}

func TestStoreMove(t *testing.T) {
	t.Run("rename in place", func(t *testing.T) {
		s := newStore(t, kbFiles())
		require.NoError(t, s.Move("guide.md", "manual.md"))

		assert.False(t, s.Exists("guide.md"))
		data, _, err := s.Read("manual.md")
		require.NoError(t, err)
		assert.Equal(t, kbFiles()["guide.md"], string(data))
	})

	t.Run("missing parents are created", func(t *testing.T) {
		s := newStore(t, kbFiles())
		require.NoError(t, s.Move("guide.md", "docs/manual/guide.md"))
		assert.True(t, s.Exists("docs/manual/guide.md"))
	})

	t.Run("directory", func(t *testing.T) {
		s := newStore(t, kbFiles())
		require.NoError(t, s.Move("notes", "archive"))
		assert.True(t, s.Exists("archive/deep/nested.md"))
	})

	tests := []struct {
		name     string
		from, to string
		err      error
	}{
		{name: "missing source", from: "nope.md", to: "x.md", err: ErrNotFound},
		{name: "existing target", from: "guide.md", to: "index.md", err: ErrExists},
		{name: "ignored source", from: ".git/config", to: "x.md", err: ErrNotFound},
		{name: "ignored target", from: "guide.md", to: ".git/x", err: ErrNotFound},
		{name: "out of the root", from: "guide.md", to: "../stolen.md", err: ErrForbidden},
		{name: "the root itself", from: "", to: "x", err: ErrForbidden},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := newStore(t, kbFiles())
			require.ErrorIs(t, s.Move(tc.from, tc.to), tc.err)
		})
	}
}

func TestStoreWalk(t *testing.T) {
	s := newStore(t, kbFiles())

	t.Run("markdown files only", func(t *testing.T) {
		visited := map[string]string{}
		require.NoError(t, s.Walk(func(fi FileInfo, data []byte) error {
			visited[fi.Path] = string(data)
			return nil
		}))
		assert.Equal(t, map[string]string{
			"guide.md":             kbFiles()["guide.md"],
			"index.md":             kbFiles()["index.md"],
			"notes/Cyrillic.md":    kbFiles()["notes/Cyrillic.md"],
			"notes/index.md":       kbFiles()["notes/index.md"],
			"notes/deep/nested.md": kbFiles()["notes/deep/nested.md"],
		}, visited)
	})

	t.Run("the callback error stops the walk", func(t *testing.T) {
		stop := errors.New("stop")
		visited := 0
		err := s.Walk(func(FileInfo, []byte) error {
			visited++
			return stop
		})
		require.ErrorIs(t, err, stop)
		assert.Equal(t, 1, visited)
	})
}

func TestStoreTree(t *testing.T) {
	t.Run("structure and order", func(t *testing.T) {
		s := newStore(t, kbFiles())
		tree, err := s.Tree()
		require.NoError(t, err)

		assert.Equal(t, FileInfo{IsDir: true, Size: tree.Size, ModTime: tree.ModTime}, tree.FileInfo)
		assert.Equal(t, []string{
			"images", "images/logo.png",
			"notes", "notes/deep", "notes/deep/nested.md", "notes/Cyrillic.md", "notes/index.md",
			"guide.md", "index.md", "snippet.py",
		}, flatten(tree))
	})

	t.Run("a mutation invalidates the cache", func(t *testing.T) {
		s := newStore(t, kbFiles(), func(c *Config) { c.TreeTTL = time.Hour })
		_, err := s.Tree()
		require.NoError(t, err)

		_, err = s.Write("fresh.md", []byte("# fresh\n"), "")
		require.NoError(t, err)

		tree, err := s.Tree()
		require.NoError(t, err)
		assert.Contains(t, flatten(tree), "fresh.md")
	})

	t.Run("a change behind our back waits for the cache to expire", func(t *testing.T) {
		s := newStore(t, kbFiles(), func(c *Config) { c.TreeTTL = time.Hour })
		before, err := s.Tree()
		require.NoError(t, err)

		require.NoError(t, os.WriteFile(filepath.Join(s.Dir(), "external.md"), []byte("x"), 0o644))

		cached, err := s.Tree()
		require.NoError(t, err)
		assert.Equal(t, flatten(before), flatten(cached))

		s.invalidate()
		fresh, err := s.Tree()
		require.NoError(t, err)
		assert.Contains(t, flatten(fresh), "external.md")
	})

	t.Run("the cache expires on its own", func(t *testing.T) {
		s := newStore(t, kbFiles(), func(c *Config) { c.TreeTTL = time.Millisecond })
		_, err := s.Tree()
		require.NoError(t, err)

		require.NoError(t, os.WriteFile(filepath.Join(s.Dir(), "external.md"), []byte("x"), 0o644))
		time.Sleep(10 * time.Millisecond)

		tree, err := s.Tree()
		require.NoError(t, err)
		assert.Contains(t, flatten(tree), "external.md")
	})

	t.Run("the caller gets a copy", func(t *testing.T) {
		s := newStore(t, kbFiles(), func(c *Config) { c.TreeTTL = time.Hour })
		first, err := s.Tree()
		require.NoError(t, err)

		first.Children[0].Name = "hacked"
		first.Children = first.Children[:1]

		second, err := s.Tree()
		require.NoError(t, err)
		assert.Equal(t, "images", second.Children[0].Name)
		assert.Len(t, second.Children, 5)
	})
}

func TestStoreTreeConcurrent(t *testing.T) {
	s := newStore(t, kbFiles(), func(c *Config) { c.TreeTTL = time.Millisecond })

	var wg sync.WaitGroup
	for i := range 4 {
		wg.Go(func() {
			for j := range 20 {
				_, err := s.Write(fmt.Sprintf("gen/%d-%d.md", i, j), []byte("x"), "")
				assert.NoError(t, err)
			}
		})
	}
	for range 4 {
		wg.Go(func() {
			for range 20 {
				_, err := s.Tree()
				assert.NoError(t, err)
			}
		})
	}
	wg.Wait()

	entries, err := s.List("gen")
	require.NoError(t, err)
	assert.Len(t, entries, 80)
}

func TestStoreUpload(t *testing.T) {
	tests := []struct {
		name     string
		dir      string
		filename string
		data     []byte
		maxSize  int64
		want     string
		err      error
	}{
		{name: "png", dir: "attachments", filename: "Pic.PNG", data: pngData, want: "attachments/pic.png"},
		{name: "gif", dir: "attachments", filename: "anim.gif", data: gifData, want: "attachments/anim.gif"},
		{name: "jpeg", dir: "attachments", filename: "photo.JPEG", data: jpegData, want: "attachments/photo.jpeg"},
		{name: "webp", dir: "attachments", filename: "pic.webp", data: webpData, want: "attachments/pic.webp"},
		{name: "pdf", dir: "attachments", filename: "spec.pdf", data: pdfData, want: "attachments/spec.pdf"},
		{name: "svg", dir: "attachments", filename: "icon.svg", data: svgData, want: "attachments/icon.svg"},
		{name: "svg with an xml header", dir: "attachments", filename: "icon.svg", data: svgXML, want: "attachments/icon.svg"},
		{name: "upload into the root", dir: "", filename: "pic.png", data: pngData, want: "pic.png"},
		{
			name: "cyrillic name", dir: "attachments", filename: "Скриншот экрана 2024.png", data: pngData,
			want: "attachments/skrinshot-ekrana-2024.png",
		},
		{
			name: "spaces and brackets", dir: "attachments", filename: "my photo (1).jpeg", data: jpegData,
			want: "attachments/my-photo-1.jpeg",
		},
		{name: "accented latin", dir: "attachments", filename: "Café Ñandú.png", data: pngData, want: "attachments/cafe-nandu.png"},
		{name: "directories are stripped", dir: "attachments", filename: "../../etc/passwd.png", data: pngData, want: "attachments/passwd.png"},
		{name: "windows path is stripped", dir: "attachments", filename: `C:\Users\me\pic.png`, data: pngData, want: "attachments/pic.png"},
		{name: "name is only an extension", dir: "attachments", filename: ".png", data: pngData, want: "attachments/file.png"},
		{name: "emoji only name", dir: "attachments", filename: "🙂🙂.png", data: pngData, want: "attachments/file.png"},
		{name: "extension not allowed", dir: "attachments", filename: "notes.txt", data: []byte("hi"), err: ErrForbidden},
		{name: "no extension", dir: "attachments", filename: "photo", data: pngData, err: ErrForbidden},
		{name: "script pretending to be a png", dir: "attachments", filename: "evil.png", data: scriptSh, err: ErrForbidden},
		{name: "script pretending to be an svg", dir: "attachments", filename: "evil.svg", data: scriptSh, err: ErrForbidden},
		{name: "png bytes in a pdf", dir: "attachments", filename: "evil.pdf", data: pngData, err: ErrForbidden},
		{name: "too large", dir: "attachments", filename: "big.png", data: pngData, maxSize: 4, err: ErrTooLarge},
		{
			name: "exactly at the cap", dir: "attachments", filename: "pic.png", data: pngData,
			maxSize: int64(len(pngData)), want: "attachments/pic.png",
		},
		{name: "ignored directory", dir: ".git", filename: "pic.png", data: pngData, err: ErrNotFound},
		{name: "directory outside the root", dir: "../elsewhere", filename: "pic.png", data: pngData, err: ErrForbidden},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			s := newStore(t, kbFiles())
			maxSize := tc.maxSize
			if maxSize == 0 {
				maxSize = 1 << 20
			}

			// act
			fi, err := s.Upload(tc.dir, tc.filename, bytes.NewReader(tc.data), maxSize)

			// assert
			if tc.err != nil {
				require.ErrorIs(t, err, tc.err)
				assert.Equal(t, FileInfo{}, fi)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, fi.Path)

			data, _, err := s.Read(tc.want)
			require.NoError(t, err)
			assert.Equal(t, tc.data, data)
		})
	}

	t.Run("a taken name gets a suffix", func(t *testing.T) {
		s := newStore(t, kbFiles())
		first, err := s.Upload("attachments", "pic.png", bytes.NewReader(pngData), 1<<20)
		require.NoError(t, err)
		second, err := s.Upload("attachments", "pic.png", bytes.NewReader(pngData), 1<<20)
		require.NoError(t, err)

		assert.Equal(t, "attachments/pic.png", first.Path)
		assert.Regexp(t, regexp.MustCompile(`^attachments/pic-[0-9a-f]{6}\.png$`), second.Path)
		assert.True(t, s.Exists(first.Path))
		assert.True(t, s.Exists(second.Path))
	})

	t.Run("no size cap", func(t *testing.T) {
		s := newStore(t, kbFiles())
		fi, err := s.Upload("attachments", "pic.png", bytes.NewReader(pngData), 0)
		require.NoError(t, err)
		assert.Equal(t, int64(len(pngData)), fi.Size)
	})

	t.Run("a broken reader is reported", func(t *testing.T) {
		s := newStore(t, kbFiles())
		_, err := s.Upload("attachments", "pic.png", iotest.ErrReader(io.ErrUnexpectedEOF), 1<<20)
		require.ErrorIs(t, err, io.ErrUnexpectedEOF)
	})
}

func TestSanitizeName(t *testing.T) {
	tests := []struct {
		name     string
		filename string
		wantName string
		wantExt  string
		err      error
	}{
		{name: "plain", filename: "pic.png", wantName: "pic", wantExt: ".png"},
		{name: "uppercase extension", filename: "PIC.PNG", wantName: "pic", wantExt: ".png"},
		{name: "cyrillic", filename: "файл.png", wantName: "fayl", wantExt: ".png"},
		{name: "cyrillic with silent letters", filename: "подъезд.png", wantName: "podezd", wantExt: ".png"},
		{name: "runs of junk collapse", filename: "a---b   c.png", wantName: "a-b-c", wantExt: ".png"},
		{name: "long name is cut", filename: strings.Repeat("a", 100) + ".png", wantName: strings.Repeat("a", maxNameLen), wantExt: ".png"},
		{name: "not allowed", filename: "notes.md", err: ErrForbidden},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			name, ext, err := sanitizeName(tc.filename)
			if tc.err != nil {
				require.ErrorIs(t, err, tc.err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.wantName, name)
			assert.Equal(t, tc.wantExt, ext)
		})
	}
}

func TestStoreReadOnly(t *testing.T) {
	s := newStore(t, kbFiles(), func(c *Config) { c.ReadOnly = true })
	require.True(t, s.ReadOnly())

	tests := []struct {
		name string
		call func() error
	}{
		{name: "write", call: func() error { _, err := s.Write("guide.md", []byte("x"), ""); return err }},
		{name: "create", call: func() error { _, err := s.Create("new.md", false); return err }},
		{name: "remove", call: func() error { return s.Remove("guide.md") }},
		{name: "move", call: func() error { return s.Move("guide.md", "other.md") }},
		{
			name: "upload",
			call: func() error {
				_, err := s.Upload("attachments", "pic.png", bytes.NewReader(pngData), 1<<20)
				return err
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			require.ErrorIs(t, tc.call(), ErrReadOnly)
		})
	}

	t.Run("reading still works", func(t *testing.T) {
		data, _, err := s.Read("guide.md")
		require.NoError(t, err)
		assert.Equal(t, kbFiles()["guide.md"], string(data))
	})
}

func TestConflictError(t *testing.T) {
	err := fmt.Errorf("save: %w", &ConflictError{Path: "a.md", CurrentRev: "sha256:abc", Current: []byte("x")})

	require.ErrorIs(t, err, ErrConflict)
	var conflict *ConflictError
	require.ErrorAs(t, err, &conflict)
	assert.Equal(t, "a.md", conflict.Path)
	assert.Contains(t, err.Error(), "a.md")
	assert.Contains(t, err.Error(), "sha256:abc")
}

func TestByDirThenName(t *testing.T) {
	entries := []FileInfo{
		{Name: "readme.md"}, {Name: "README.md"}, {Name: "Zebra.md"},
		{Name: "alpha", IsDir: true}, {Name: "Beta", IsDir: true}, {Name: "apple.md"},
	}

	slices.SortFunc(entries, byDirThenName)

	assert.Equal(t, []string{"alpha", "Beta", "apple.md", "README.md", "readme.md", "Zebra.md"}, names(entries))
}

func TestRev(t *testing.T) {
	assert.Equal(t, "sha256:8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4", Rev([]byte("hi")))
	assert.NotEqual(t, Rev([]byte("a")), Rev([]byte("b")))
	assert.Equal(t, Rev(nil), Rev([]byte{}))
}

func TestOpString(t *testing.T) {
	tests := []struct {
		name string
		op   Op
		want string
	}{
		{name: "empty", op: 0, want: "none"},
		{name: "single", op: OpWrite, want: "write"},
		{name: "merged", op: OpCreate | OpWrite, want: "create|write"},
		{name: "all", op: OpCreate | OpWrite | OpRemove | OpRename, want: "create|write|remove|rename"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, tc.op.String())
		})
	}

	t.Run("has", func(t *testing.T) {
		assert.True(t, (OpCreate | OpWrite).Has(OpWrite))
		assert.True(t, OpCreate.Has(OpCreate|OpWrite))
		assert.False(t, OpCreate.Has(OpWrite))
	})
}
