package view

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/store"
)

// TestURLsEscapeAwkwardPaths guards the builders that make a link out of a
// content path. A file name may hold anything the filesystem allows, and a
// question mark pasted into an href would turn the rest of the name into a
// query string.
func TestURLsEscapeAwkwardPaths(t *testing.T) {
	// arrange
	const awkward = "notes/что? да.md"
	const escaped = "notes/%D1%87%D1%82%D0%BE%3F%20%D0%B4%D0%B0.md"

	tests := []struct {
		name string
		got  string
		want string
	}{
		{name: "document", got: ContentURL(awkward), want: "/doc/" + escaped},
		{name: "editor", got: EditURL(awkward), want: "/edit/" + escaped},
		{name: "directory", got: DirURL("notes/что? да"), want: "/doc/notes/%D1%87%D1%82%D0%BE%3F%20%D0%B4%D0%B0/"},
		// a hit carries the query on, which is what lights up the match on the
		// page it opens, so the link is a path and a query together
		{name: "search hit", got: SearchURL(awkward, "да"), want: "/doc/" + escaped + "?q=%D0%B4%D0%B0"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act & assert
			assert.Equal(t, tc.want, tc.got)
		})
	}
}

func TestContentURL(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		expected string
	}{
		{name: "markdown", path: "notes/page.md", expected: "/doc/notes/page.md"},
		{name: "uppercase markdown", path: "notes/PAGE.MD", expected: "/doc/notes/PAGE.MD"},
		{name: "attachment", path: "images/logo.png", expected: "/raw/images/logo.png"},
		{name: "cyrillic", path: "заметки.md", expected: "/doc/%D0%B7%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B8.md"},
		{name: "space", path: "my file.png", expected: "/raw/my%20file.png"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act & assert
			assert.Equal(t, tc.expected, ContentURL(tc.path))
		})
	}
}

func TestBreadcrumbs(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		expected []Crumb
	}{
		{name: "root", path: "", expected: []Crumb{{Name: "Home"}}},
		{name: "top level file", path: "guide.md",
			expected: []Crumb{{Name: "Home", URL: "/"}, {Name: "guide.md"}}},
		{name: "nested file", path: "notes/deep/nested.md", expected: []Crumb{
			{Name: "Home", URL: "/"}, {Name: "notes", URL: "/doc/notes/"},
			{Name: "deep", URL: "/doc/notes/deep/"}, {Name: "nested.md"},
		}},
		{name: "cyrillic segment", path: "заметки/файл.md", expected: []Crumb{
			{Name: "Home", URL: "/"}, {Name: "заметки", URL: "/doc/%D0%B7%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B8/"},
			{Name: "файл.md"},
		}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			crumbs := Breadcrumbs(tc.path)

			// assert
			assert.Equal(t, tc.expected, crumbs)
		})
	}
}

func TestNewPage(t *testing.T) {
	// arrange
	res := render.Result{
		HTML:  "<h1>Guide</h1>",
		Title: "Guide",
		TOC: []render.Heading{
			{ID: "one", Text: "One", Level: 2}, {ID: "two", Text: "Two", Level: 2}, {ID: "three", Text: "Three", Level: 2},
		},
	}
	mod := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)

	// act
	got := NewPage("docs", "docs/index.md", res, "rev1", mod, true)

	// assert
	toc := render.OutlineOf(res.TOC)
	assert.Equal(t, Page{
		Path:        "docs",
		DocPath:     "docs/index.md",
		Kind:        KindDocument,
		Title:       res.Title,
		HTML:        string(res.HTML),
		TOC:         toc,
		ShowTOC:     len(toc) >= render.MinOutline,
		Rev:         "rev1",
		ModTime:     mod,
		Breadcrumbs: Breadcrumbs("docs"),
		EditURL:     EditURL("docs/index.md"),
		CanCreate:   true,
	}, got)
}

func TestMissingPage(t *testing.T) {
	// act
	got := MissingPage("docs/new.md", false)

	// assert
	assert.Equal(t, Page{
		Path:        "docs/new.md",
		DocPath:     "docs/new.md",
		Kind:        KindMissingDocument,
		Title:       "new.md",
		TOC:         []render.Heading{},
		Breadcrumbs: Breadcrumbs("docs/new.md"),
		EditURL:     EditURL("docs/new.md"),
		Missing:     true,
	}, got)
}

func TestNewDir(t *testing.T) {
	tests := []struct {
		name  string
		path  string
		title string
	}{
		{name: "root", path: "", title: "Home"},
		{name: "folder", path: "docs/sub", title: "sub"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			entries := []store.FileInfo{{Name: "a.md", Path: tc.path + "/a.md"}}

			// act
			got := NewDir(tc.path, entries)

			// assert
			assert.Equal(t, Dir{
				Path:        tc.path,
				Kind:        KindDirectory,
				Title:       tc.title,
				Entries:     DirEntries(entries),
				Breadcrumbs: Breadcrumbs(tc.path),
			}, got)
		})
	}
}

func TestDirEntries(t *testing.T) {
	// arrange
	mod := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	entries := []store.FileInfo{
		{Name: "sub", Path: "docs/sub", IsDir: true, ModTime: mod},
		{Name: "a.md", Path: "docs/a.md", Size: 3, ModTime: mod},
		{Name: "b.png", Path: "docs/b.png", Size: 4, ModTime: mod},
	}

	// act
	got := DirEntries(entries)

	// assert
	assert.Equal(t, []DirEntry{
		{Name: "sub", Path: "docs/sub", URL: "/doc/docs/sub/", IsDir: true, ModTime: mod},
		{Name: "a.md", Path: "docs/a.md", URL: "/doc/docs/a.md", Size: 3, ModTime: mod},
		{Name: "b.png", Path: "docs/b.png", URL: "/raw/docs/b.png", Size: 4, ModTime: mod},
	}, got)
}

func TestIndexOf(t *testing.T) {
	// arrange
	entries := []store.FileInfo{
		{Name: "Index.MD", Path: "docs/sub", IsDir: true},
		{Name: "README.md", Path: "docs/README.md"},
		{Name: "INDEX.md", Path: "docs/INDEX.md"},
	}

	tests := []struct {
		name string
		want string
		path string
	}{
		{name: "index in another case", want: IndexName, path: "docs/INDEX.md"},
		{name: "readme in another case", want: ReadmeName, path: "docs/README.md"},
		{name: "missing", want: "notes.md", path: ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act & assert
			assert.Equal(t, tc.path, IndexOf(entries, tc.want))
		})
	}
}

func TestNav(t *testing.T) {
	// arrange
	dir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "docs", "sub"), 0o755))
	for name, content := range map[string]string{"docs/sub/deep.md": "# Deep\n", "top.md": "# Top\n", "docs/pic.png": "png"} {
		require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600))
	}
	st, err := store.New(store.Config{Root: dir})
	require.NoError(t, err)
	t.Cleanup(func() { _ = st.Close() })
	root, err := st.Tree()
	require.NoError(t, err)

	// act
	got := Nav(root, "docs/sub/deep.md")

	// assert
	assert.Equal(t, []NavNode{
		{Name: "docs", Path: "docs", URL: "/doc/docs/", IsDir: true, Active: true, Children: []NavNode{
			{Name: "sub", Path: "docs/sub", URL: "/doc/docs/sub/", IsDir: true, Active: true, Children: []NavNode{
				{Name: "deep.md", Path: "docs/sub/deep.md", URL: "/doc/docs/sub/deep.md", Current: true, Children: []NavNode{}},
			}},
		}},
		{Name: "top.md", Path: "top.md", URL: "/doc/top.md", Children: []NavNode{}},
	}, got)
}
