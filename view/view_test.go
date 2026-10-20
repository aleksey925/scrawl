package view

import (
	"os"
	"path/filepath"
	"strings"
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
		{name: "a picture has a page too", path: "images/logo.png", expected: "/doc/images/logo.png"},
		{name: "cyrillic", path: "заметки.md", expected: "/doc/%D0%B7%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B8.md"},
		{name: "space", path: "my file.png", expected: "/doc/my%20file.png"},
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
	got := NewPage("docs/index.md", res, "rev1", mod, true)

	// assert
	toc := render.OutlineOf(res.TOC)
	assert.Equal(t, Page{
		Path:        "docs/index.md",
		Kind:        KindDocument,
		Title:       res.Title,
		HTML:        string(res.HTML),
		TOC:         toc,
		ShowTOC:     len(toc) >= render.MinOutline,
		Rev:         "rev1",
		ModTime:     mod,
		Breadcrumbs: Breadcrumbs("docs/index.md"),
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
		Kind:        KindMissingDocument,
		Title:       "new.md",
		TOC:         []render.Heading{},
		Breadcrumbs: Breadcrumbs("docs/new.md"),
		EditURL:     EditURL("docs/new.md"),
		Missing:     true,
	}, got)
}

func noItems(string) int { return 0 }

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
			got := NewDir(tc.path, entries, noItems, NotEditable)

			// assert
			assert.Equal(t, Dir{
				Path:        tc.path,
				Kind:        KindDirectory,
				Title:       tc.title,
				Entries:     DirEntries(entries, noItems, NotEditable),
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
		{Name: "Index.md", Path: "docs/Index.md", Size: 5, ModTime: mod},
	}

	// act
	notes := func(fi store.FileInfo) bool { return strings.HasSuffix(fi.Name, ".md") }
	got := DirEntries(entries, func(dir string) int { return len(dir) }, notes)

	// assert
	assert.Equal(t, []DirEntry{
		{Name: "sub", Path: "docs/sub", URL: "/doc/docs/sub/", IsDir: true, ModTime: mod, Items: len("docs/sub")},
		{Name: "a.md", Path: "docs/a.md", URL: "/doc/docs/a.md", Size: 3, ModTime: mod, EditURL: "/edit/docs/a.md"},
		{Name: "b.png", Path: "docs/b.png", URL: "/doc/docs/b.png", Size: 4, ModTime: mod},
		{Name: "Index.md", Path: "docs/Index.md", URL: "/doc/docs/Index.md", Size: 5, ModTime: mod, FolderPage: true,
			EditURL: "/edit/docs/Index.md"},
	}, got)
}

func TestItemsIn(t *testing.T) {
	// arrange
	listings := map[string][]store.FileInfo{"docs": {{Name: "a.md"}, {Name: "b"}}}
	list := func(dir string) ([]store.FileInfo, error) {
		entries, ok := listings[dir]
		if !ok {
			return nil, store.ErrNotFound
		}
		return entries, nil
	}

	// act
	count := ItemsIn(list)

	// assert
	assert.Equal(t, []int{len(listings["docs"]), 0}, []int{count("docs"), count("gone")})
}

func TestIndexOf(t *testing.T) {
	tests := []struct {
		name    string
		entries []store.FileInfo
		want    string
	}{
		{
			name: "index in another case",
			entries: []store.FileInfo{
				{Name: "Index.MD", Path: "docs/Index.MD", IsDir: true},
				{Name: "README.md", Path: "docs/README.md"},
				{Name: "INDEX.md", Path: "docs/INDEX.md"},
			},
			want: "docs/INDEX.md",
		},
		{
			name:    "two cases of the name are none",
			entries: []store.FileInfo{{Name: "INDEX.md", Path: "docs/INDEX.md"}, {Name: "index.md", Path: "docs/index.md"}},
		},
		{
			name:    "a readme is no index",
			entries: []store.FileInfo{{Name: "README.md", Path: "docs/README.md"}},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act & assert
			assert.Equal(t, tc.want, IndexOf(tc.entries))
		})
	}
}

func TestNav(t *testing.T) {
	// arrange
	dir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "docs", "sub"), 0o755))
	files := map[string]string{
		"docs/sub/deep.md": "# Deep\n", "docs/index.md": "# Docs\n", "top.md": "# Top\n", "docs/pic.png": "png",
	}
	for name, content := range files {
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
			{Name: "index.md", Path: "docs/index.md", URL: "/doc/docs/index.md", FolderPage: true, Children: []NavNode{}},
		}},
		{Name: "top.md", Path: "top.md", URL: "/doc/top.md", Children: []NavNode{}},
	}, got)
}

func TestNewFile(t *testing.T) {
	// arrange
	mod := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	fi := store.FileInfo{Name: "my logo.png", Path: "images/my logo.png", Size: 7, ModTime: mod}

	// act
	got := NewFile(fi, FileImage)

	// assert
	assert.Equal(t, File{
		Path:        fi.Path,
		Kind:        KindFile,
		Name:        fi.Name,
		Type:        FileImage,
		Size:        fi.Size,
		ModTime:     mod,
		Breadcrumbs: Breadcrumbs(fi.Path),
		RawURL:      "/raw/images/my%20logo.png",
	}, got)
}

func TestFindURL(t *testing.T) {
	tests := []struct {
		name string
		find Find
		line int
		want string
	}{
		{name: "a word", find: Find{Text: "vacuum"}, want: "/doc/db/a.md?q=vacuum"},
		{name: "every toggle and a line", find: Find{Text: "a|b", Case: true, Word: true, Regex: true}, line: 12,
			want: "/doc/db/a.md?case=1&line=12&q=a%7Cb&regex=1&word=1"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act & assert
			assert.Equal(t, tc.want, FindURL("db/a.md", tc.find, tc.line))
		})
	}
}
