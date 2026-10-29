package main

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/page"
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/server"
	"github.com/aleksey925/scrawl/store"
	"github.com/aleksey925/scrawl/view"
)

func writeTree(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	for name, content := range files {
		p := filepath.Join(dir, filepath.FromSlash(name))
		require.NoError(t, os.MkdirAll(filepath.Dir(p), 0o750))
		require.NoError(t, os.WriteFile(p, []byte(content), 0o600))
	}
}

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

var pageData = regexp.MustCompile(`<script type="application/json" data-scrawl="page">(.*?)</script>`)

func readPageData(t *testing.T, dir, name string) map[string]any {
	t.Helper()
	match := pageData.FindStringSubmatch(readSite(t, dir, name))
	require.Len(t, match, 2, "%s carries no answer", name)
	var res map[string]any
	require.NoError(t, json.Unmarshal([]byte(match[1]), &res))
	return res
}

func jsonOf(t *testing.T, value any) any {
	t.Helper()
	data, err := json.Marshal(value)
	require.NoError(t, err)
	var res any
	require.NoError(t, json.Unmarshal(data, &res))
	return res
}

func openNotes(t *testing.T, dir string) *store.Store {
	t.Helper()
	st, err := store.New(store.Config{Root: dir, ReadOnly: true})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, st.Close()) })
	return st
}

var siteAssetFiles = []string{
	"scrawl/boot.js", "scrawl/chroma.css", "scrawl/favicon.svg", "scrawl/site.css", "scrawl/site.js", "scrawl/tree.js",
}

func withAssets(files ...string) []string {
	res := append(slices.Clone(siteAssetFiles), files...)
	slices.Sort(res)
	return res
}

func TestRunSite(t *testing.T) {
	notes := map[string]string{
		"index.md":                  "# Home\n\n[Guide](docs/guide.md) and [docs](docs/)\n",
		"docs/guide.md":             "# Guide\n\n[home](../index.md) and ![pic](guide/pic.png)\n",
		"docs/guide/pic.png":        "\x89PNG picture",
		"docs/README.md":            "# Docs\n\nwhat is here\n",
		".hidden/secret.md":         "# Secret\n",
		".env":                      "TOKEN=secret\n",
		"docs/node_modules/a/x.md":  "# Dependency\n",
		"docs/guide/.DS_Store":      "finder",
		"drafts/unfinished.md":      "# Draft\n",
		"drafts/unfinished.md.orig": "# Old draft\n",
	}

	t.Run("every visible note and folder is a page and every other file is copied", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, notes)

		// act
		code, stdout, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		assert.Equal(t, fmt.Sprintf("8 pages and 2 other files written to %s\n", out), stdout)
		assert.Equal(t, withAssets(
			"404.html",
			"docs/README.html",
			"docs/guide.html",
			"docs/guide/index.html",
			"docs/guide/pic.png",
			"docs/index.html",
			"drafts/index.html",
			"drafts/unfinished.html",
			"drafts/unfinished.md.orig",
			"index.html",
			"index.md.html",
		), listTree(t, out))
		assert.Equal(t, notes["docs/guide/pic.png"], readSite(t, out, "docs/guide/pic.png"))
	})

	t.Run("a note carries the answer the server gives for it", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, notes)
		st := openNotes(t, src)
		data, fi, err := st.Read("docs/guide.md")
		require.NoError(t, err)
		res, err := render.New(render.Options{
			Relative: true, PageExt: ".html", FolderPage: "index.html", IndexPage: "index.md.html",
		}).Render(data, "docs/guide.md")
		require.NoError(t, err)

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		assert.Equal(t, map[string]any{
			"route":  view.ContentURL("docs/guide.md"),
			"root":   "../",
			"answer": jsonOf(t, view.NewPage("docs/guide.md", res, store.Rev(data), fi.ModTime, false)),
		}, readPageData(t, out, "docs/guide.html"))
	})

	t.Run("a folder is its list and its index note is index.md.html", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, notes)

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		home := readPageData(t, out, "index.html")
		assert.Equal(t, "/", home["route"])
		assert.Equal(t, "./", home["root"])
		answer, ok := home["answer"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, []any{"", view.KindDirectory}, []any{answer["path"], answer["kind"]})
		index := readPageData(t, out, "index.md.html")
		assert.Equal(t, view.ContentURL("index.md"), index["route"])
		note, ok := index["answer"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, []any{"index.md", view.KindDocument}, []any{note["path"], note["kind"]})
	})

	t.Run("a folder's readme is a row of its listing", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, notes)
		st := openNotes(t, src)
		entries, err := st.List("docs")
		require.NoError(t, err)

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		docs := readPageData(t, out, "docs/index.html")
		assert.Equal(t, view.DirURL("docs"), docs["route"])
		answer, ok := docs["answer"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, view.KindDirectory, answer["kind"])
		assert.Equal(t, jsonOf(t, view.DirEntries(entries, st.Count, view.NotEditable)), answer["entries"])
		assert.NotContains(t, answer, "readme_html")
	})

	t.Run("the links between pages are the files of the site", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, notes)

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		home := readSite(t, out, "index.md.html")
		assert.Contains(t, home, `<a href="docs/guide.html">Guide</a>`)
		assert.Contains(t, home, `<a href="docs/index.html">docs</a>`)
		guide := readSite(t, out, "docs/guide.html")
		assert.Contains(t, guide, `<a href="../index.md.html">home</a>`)
		assert.Contains(t, guide, `src="guide/pic.png"`)
		assert.Contains(t, guide, `<script defer src="../scrawl/site.js"></script>`)
	})

	t.Run("a reader without javascript gets the path and what a folder holds", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, notes)

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		guide := readSite(t, out, "docs/guide.html")
		assert.Contains(t, guide, `<li><a href="../index.html">Home</a></li><li><a href="../docs/index.html">docs</a></li><li>guide.md</li>`)
		docs := readSite(t, out, "docs/index.html")
		assert.Equal(t, []string{
			`<li><a href="./guide/index.html">guide</a></li>`,
			`<li><a href="./guide.html">guide.md</a></li>`,
			`<li><a href="./README.html">README.md</a></li>`,
		}, regexp.MustCompile(`<li><a href="\./[^"]*">[^<]*</a></li>`).FindAllString(docs, -1))
	})

	t.Run("the tree is one file and leaves out folders with no note", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, notes)
		root, err := openNotes(t, src).Tree()
		require.NoError(t, err)

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		tree := readSite(t, out, "scrawl/tree.js")
		require.True(t, strings.HasPrefix(tree, "self.scrawlSite = "))
		var got siteData
		require.NoError(t, json.Unmarshal([]byte(strings.TrimSuffix(strings.TrimPrefix(tree, "self.scrawlSite = "), ";\n")), &got))
		assert.Equal(t, siteData{Title: "Home", Tree: withNotes(view.Nav(root, ""))}, got)
		assert.Equal(t, []string{"docs", "drafts", "index.md"}, []string{got.Tree[0].Name, got.Tree[1].Name, got.Tree[2].Name})
		assert.Equal(t, []string{"guide.md", "README.md"}, []string{got.Tree[0].Children[0].Name, got.Tree[0].Children[1].Name})
	})

	t.Run("without an index the site is called Notes", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, map[string]string{"a.md": "# A\n"})

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		assert.Contains(t, readSite(t, out, "scrawl/tree.js"), `"title":"Notes"`)
	})

	t.Run("the shared files are the ones the binary carries", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, notes)

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		for name, content := range page.SiteAssets() {
			assert.Equal(t, content, readSite(t, out, "scrawl/"+name))
		}
		assert.Equal(t, string(render.ChromaCSS()), readSite(t, out, "scrawl/chroma.css"))
		assert.Equal(t, string(server.Favicon()), readSite(t, out, "scrawl/favicon.svg"))
	})

	t.Run("a renderer is written only once a note needs it", func(t *testing.T) {
		tests := []struct {
			name  string
			notes map[string]string
			want  []string
		}{
			{name: "nothing to render", notes: map[string]string{"a.md": "# A\n"}, want: withAssets("404.html", "a.html", "index.html")},
			{
				name:  "a diagram",
				notes: map[string]string{"a.md": "# A\n\n```mermaid\ngraph TD;\n```\n"},
				want:  withAssets("404.html", "a.html", "index.html", "scrawl/"+page.DiagramsFile),
			},
			{
				name:  "a plantuml diagram",
				notes: map[string]string{"a.md": "# A\n\n```plantuml\nA -> B\n```\n"},
				want:  withAssets("404.html", "a.html", "index.html", "scrawl/"+page.PlantUMLFile),
			},
			{
				name:  "a plantuml diagram that includes a library",
				notes: map[string]string{"a.md": "# A\n\n```plantuml\n!include <C4/C4_Context>\nPerson(u, \"U\")\n```\n"},
				want: withAssets("404.html", "a.html", "index.html", "scrawl/"+page.PlantUMLFile,
					"scrawl/plantuml/c4.min.js", "scrawl/plantuml/office.min.js", "scrawl/plantuml/themes.js"),
			},
			{
				name: "both kinds of diagram in two notes",
				notes: map[string]string{
					"a.md": "# A\n\n```mermaid\ngraph TD;\n```\n",
					"b.md": "# B\n\n```puml\nA -> B\n```\n",
				},
				want: withAssets("404.html", "a.html", "b.html", "index.html",
					"scrawl/"+page.DiagramsFile, "scrawl/"+page.PlantUMLFile),
			},
			{
				name:  "a formula in a folder's readme",
				notes: map[string]string{"d/README.md": "# D\n\n$x$\n"},
				want: withAssets("404.html", "d/README.html", "d/index.html", "index.html",
					"scrawl/"+page.MathScriptFile, "scrawl/"+page.MathStyleFile),
			},
		}
		for _, tc := range tests {
			t.Run(tc.name, func(t *testing.T) {
				// arrange
				src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
				writeTree(t, src, tc.notes)

				// act
				code, _, stderr := runCLI(t, "", "site", "-o", out, src)

				// assert
				require.Equal(t, 0, code, stderr)
				assert.Equal(t, tc.want, listTree(t, out))
			})
		}
	})

	t.Run("a note of its own takes the place of the page for a missing address", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, map[string]string{"404.md": "# Lost\n"})

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		assert.Contains(t, readSite(t, out, "404.html"), "<title>Lost</title>")
	})

	t.Run("a folder where the page for a missing address goes keeps its place", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, map[string]string{"404.html/a.md": "# A\n"})

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		assert.Equal(t, withAssets("404.html/a.html", "404.html/index.html", "index.html"), listTree(t, out))
	})

	t.Run("two indexes of the root in another case are refused", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, map[string]string{"index.md": "# One\n", "INDEX.md": "# Two\n"})
		if entries, err := os.ReadDir(src); err != nil || len(entries) != 2 {
			t.Skip("the filesystem folds the case of a name, so it holds one of them")
		}

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		assert.Equal(t, 1, code)
		assert.Contains(t, stderr, "would both be written to index.md.html")
		assert.NoDirExists(t, out)
	})

	t.Run("a note named index.md.md beside an index is refused, naming both", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, map[string]string{"d/index.md": "# One\n", "d/index.md.md": "# Two\n"})

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		assert.Equal(t, 1, code)
		assert.Contains(t, stderr, "d/index.md")
		assert.Contains(t, stderr, "d/index.md.md")
		assert.Contains(t, stderr, "would both be written to d/index.md.html")
		assert.NoDirExists(t, out)
	})

	t.Run("a note that names the closing tag of a script stays inside its own", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, map[string]string{"a.md": "# `</script><script>` in a title\n"})

		// act
		code, _, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		answer, ok := readPageData(t, out, "a.html")["answer"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "</script><script> in a title", answer["title"])
	})

	t.Run("files a browser runs a script from are named", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, map[string]string{"a.md": "# A\n", "art/logo.SVG": "<svg/>", "demo.html": "<p>x</p>", "pic.png": "png"})

		// act
		code, stdout, stderr := runCLI(t, "", "site", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		assert.Contains(t, stdout, "warning: copied as they are, these files run their scripts when opened from the site: art/logo.SVG, demo.html\n")
	})

	t.Run("exclude leaves notes out", func(t *testing.T) {
		// arrange
		src, out := t.TempDir(), filepath.Join(t.TempDir(), "site")
		writeTree(t, src, notes)

		// act
		code, _, stderr := runCLI(t, "", "site", "--exclude", "drafts", "-o", out, src)

		// assert
		require.Equal(t, 0, code, stderr)
		assert.NotContains(t, listTree(t, out), "drafts/unfinished.html")
		assert.NotContains(t, listTree(t, out), "drafts/index.html")
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
				name:  "a page where the page of a folder goes",
				files: map[string]string{"docs/a.md": "# A\n", "docs/index.html": "<p>mine</p>"},
				want:  "docs/ and docs/index.html would both be written to docs/index.html",
			},
			{
				name:  "a note where a folder of the site goes",
				files: map[string]string{"a.md": "# A\n", "a.html/b.md": "# B\n"},
				want:  "a.md is written to a.html, where a.html/b.md needs a folder",
			},
			{
				name:  "notes in the directory of the scripts",
				files: map[string]string{"scrawl/notes.md": "# Notes\n"},
				want:  "scrawl/ is where the site keeps its scripts, and the notes hold scrawl/",
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

func TestWithNotes(t *testing.T) {
	// arrange
	nodes := []view.NavNode{
		{Name: "docs", Path: "docs", IsDir: true, Children: []view.NavNode{
			{Name: "a.md", Path: "docs/a.md", Children: []view.NavNode{}},
			{Name: "empty", Path: "docs/empty", IsDir: true, Children: []view.NavNode{}},
		}},
		{Name: "pictures", Path: "pictures", IsDir: true, Children: []view.NavNode{
			{Name: "deeper", Path: "pictures/deeper", IsDir: true, Children: []view.NavNode{}},
		}},
		{Name: "b.md", Path: "b.md", Children: []view.NavNode{}},
	}

	// act
	got := withNotes(nodes)

	// assert
	assert.Equal(t, []view.NavNode{
		{Name: "docs", Path: "docs", IsDir: true, Children: []view.NavNode{
			{Name: "a.md", Path: "docs/a.md", Children: []view.NavNode{}},
		}},
		{Name: "b.md", Path: "b.md", Children: []view.NavNode{}},
	}, got)
}
