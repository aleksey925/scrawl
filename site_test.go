package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/page"
	"github.com/aleksey925/scrawl/store"
)

// writeTree creates files under dir, keyed by slash-separated paths.
func writeTree(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	for name, content := range files {
		p := filepath.Join(dir, filepath.FromSlash(name))
		require.NoError(t, os.MkdirAll(filepath.Dir(p), 0o750))
		require.NoError(t, os.WriteFile(p, []byte(content), 0o600))
	}
}

// listTree is every file under dir, as sorted slash-separated relative paths.
func listTree(t *testing.T, dir string) []string {
	t.Helper()
	res := []string{}
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, relErr := filepath.Rel(dir, p)
		res = append(res, filepath.ToSlash(rel))
		return relErr
	})
	require.NoError(t, err)
	slices.Sort(res)
	return res
}

func readSite(t *testing.T, dir, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(name)))
	require.NoError(t, err)
	return string(data)
}

func TestTreeEntries(t *testing.T) {
	// arrange
	nodes := []siteNode{
		{name: "docs", path: "docs", dir: true, children: []siteNode{
			{name: "a b.md", path: "docs/a b.md"},
			{name: "deep", path: "docs/deep", dir: true, children: []siteNode{{name: "x.md", path: "docs/deep/x.md"}}},
		}},
		{name: "index.md", path: "index.md"},
	}

	// act
	got := treeEntries(nodes, "docs/a b.md", "../")

	// assert
	assert.Equal(t, []page.TreeEntry{
		{Name: "docs", Open: true, Children: []page.TreeEntry{
			{Name: "a b.md", Href: "../docs/a%20b.html", Current: true},
			{Name: "deep", Children: []page.TreeEntry{{Name: "x.md", Href: "../docs/deep/x.html"}}},
		}},
		{Name: "index.md", Href: "../index.html"},
	}, got)
}

func TestSiteTree(t *testing.T) {
	// arrange
	src := t.TempDir()
	writeTree(t, src, map[string]string{
		"index.md":           "# Home\n",
		"docs/guide.md":      "# Guide\n",
		"docs/guide/pic.png": "picture",
		"pictures/a.png":     "picture",
		"drafts/old/plan.md": "# Plan\n",
		".hidden/secret.md":  "# Secret\n",
		"notes.markdown":     "# Not a note\n",
	})
	require.NoError(t, os.MkdirAll(filepath.Join(src, "empty"), 0o750))
	st, err := store.New(store.Config{Root: src, ReadOnly: true})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, st.Close()) })

	// act
	got, err := siteTree(st)

	// assert
	require.NoError(t, err)
	assert.Equal(t, []siteNode{
		{name: "docs", path: "docs", dir: true, children: []siteNode{{name: "guide.md", path: "docs/guide.md"}}},
		{name: "drafts", path: "drafts", dir: true, children: []siteNode{
			{name: "old", path: "drafts/old", dir: true, children: []siteNode{{name: "plan.md", path: "drafts/old/plan.md"}}},
		}},
		{name: "index.md", path: "index.md"},
	}, got)
}

func TestRunSite(t *testing.T) {
	notes := map[string]string{
		"index.md":                  "# Home\n\n[Guide](docs/guide.md)\n",
		"docs/guide.md":             "# Guide\n\n[home](../index.md) and ![pic](guide/pic.png)\n",
		"docs/guide/pic.png":        "\x89PNG picture",
		".hidden/secret.md":         "# Secret\n",
		".env":                      "TOKEN=secret\n",
		"docs/node_modules/a/x.md":  "# Dependency\n",
		"docs/guide/.DS_Store":      "finder",
		"drafts/unfinished.md":      "# Draft\n",
		"drafts/unfinished.md.orig": "# Old draft\n",
	}

	t.Run("every visible note is a page and every other file is copied", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, notes)

		// act
		code, stdout, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		assert.Equal(t, fmt.Sprintf("3 pages and 2 other files written to %s\n", out), stdout)
		assert.Equal(t, []string{
			"docs/guide.html",
			"docs/guide/pic.png",
			"drafts/unfinished.html",
			"drafts/unfinished.md.orig",
			"index.html",
			"scrawl/page.css",
			"scrawl/page.js",
		}, listTree(t, out))
		assert.Equal(t, notes["docs/guide/pic.png"], readSite(t, out, "docs/guide/pic.png"))
	})

	t.Run("a page links the shared assets, its home and its neighbors", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, notes)

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		guide := readSite(t, out, "docs/guide.html")
		assert.Contains(t, guide, `<link rel="stylesheet" href="../scrawl/page.css">`)
		assert.Contains(t, guide, `<script src="../scrawl/page.js"></script>`)
		assert.Contains(t, guide, `<a class="page-home" href="../index.html">Home</a>`)
		assert.Contains(t, guide, `<a href="../index.html">home</a>`)
		assert.Contains(t, guide, `src="guide/pic.png"`)
		home := readSite(t, out, "index.html")
		assert.Contains(t, home, `<a class="page-home" href="./index.html">Home</a>`)
		assert.Contains(t, home, `<a href="docs/guide.html">Guide</a>`)
		assets := page.Assets(page.Options{})
		assert.Equal(t, assets[page.StylesheetFile], readSite(t, out, "scrawl/page.css"))
		assert.Equal(t, assets[page.ScriptFile], readSite(t, out, "scrawl/page.js"))
	})

	t.Run("without an index there is no home link", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, map[string]string{"a.md": "# A\n"})

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		assert.NotContains(t, readSite(t, out, "a.html"), `class="page-home"`)
	})

	t.Run("the tree marks the note of the page and opens the way to it", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, notes)

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		guide := readSite(t, out, "docs/guide.html")
		assert.Contains(t, guide, `<li><details open><summary style="--depth: 0">`)
		assert.Contains(t, guide, `<a href="../docs/guide.html" style="--depth: 1" aria-current="page">`)
		assert.Contains(t, guide, `<a href="../index.html" style="--depth: 0">`)
	})

	t.Run("an outline is listed once a note has enough sections", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, map[string]string{
			"long.md":  "# Long\n\n## One\n\n## Two\n\n### Two and a half\n",
			"short.md": "# Short\n\n## One\n\n## Two\n",
		})

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		long := readSite(t, out, "long.html")
		assert.Equal(t, []string{
			`<a href="#one" data-level="2">One</a>`,
			`<a href="#two" data-level="2">Two</a>`,
			`<a href="#two-and-a-half" data-level="3">Two and a half</a>`,
		}, regexp.MustCompile(`<a href="#[^"]*" data-level="\d">[^<]*</a>`).FindAllString(long, -1))
		assert.NotContains(t, readSite(t, out, "short.html"), `class="site-outline"`)
	})

	t.Run("math goes into the shared assets once", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, map[string]string{"a.md": "# A\n\n$x$\n"})

		// act
		code, _, stderr := runCLI(t, "", "site", "--math", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		assets := page.Assets(page.Options{Math: true})
		assert.Equal(t, assets[page.StylesheetFile], readSite(t, out, "scrawl/page.css"))
		assert.Equal(t, assets[page.ScriptFile], readSite(t, out, "scrawl/page.js"))
	})

	t.Run("the diagram renderer is written once a note has a diagram", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, map[string]string{"a.md": "# A\n\n```mermaid\ngraph TD;\n```\n", "b.md": "# B\n"})

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		assert.Equal(t, []string{"a.html", "b.html", "scrawl/diagrams.js", "scrawl/page.css", "scrawl/page.js"}, listTree(t, out))
		assert.Equal(t, page.Diagrams(), readSite(t, out, "scrawl/"+page.DiagramsFile))
	})

	t.Run("exclude leaves notes out", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, notes)

		// act
		code, _, stderr := runCLI(t, "", "site", "--exclude", "drafts", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		assert.Equal(t, []string{
			"docs/guide.html",
			"docs/guide/pic.png",
			"index.html",
			"scrawl/page.css",
			"scrawl/page.js",
		}, listTree(t, out))
	})

	t.Run("an output directory with something in it is left alone", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), t.TempDir()
		writeTree(t, src, notes)
		writeTree(t, out, map[string]string{"keep.txt": "mine"})

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		assert.Equal(t, 1, code)
		assert.Contains(t, stderr, out+" is not empty")
		assert.Equal(t, []string{"keep.txt"}, listTree(t, out))
	})

	t.Run("refuses notes that would land on one file", func(t *testing.T) {
		tests := []struct {
			name  string
			files map[string]string
			want  string
		}{
			{
				name:  "a note and a page of the same name",
				files: map[string]string{"a.md": "# A\n", "a.html": "<p>a</p>"},
				want:  "a.html and a.md would both be written to a.html",
			},
			{
				name:  "notes in the directory of the stylesheet",
				files: map[string]string{"scrawl/notes.md": "# Notes\n"},
				want:  "scrawl/ is where the site keeps its stylesheet, and the notes hold scrawl/notes.md",
			},
		}
		for _, tc := range tests {
			t.Run(tc.name, func(t *testing.T) {
				// arrange
				src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
				writeTree(t, src, tc.files)

				// act
				code, _, stderr := runCLI(t, "", "site", "-o", out, src)

				// assert
				assert.Equal(t, 1, code)
				assert.Contains(t, stderr, tc.want)
				assert.NoDirExists(t, out)
			})
		}
	})
}
