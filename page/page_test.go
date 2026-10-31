package page

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/htmldiff"
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/theme"
)

func TestWriteNote(t *testing.T) {
	note := Note{Title: "A <title>", HTML: `<h1>Head</h1><p>text &amp; more</p>`}

	t.Run("a page of its own carries the note and its look", func(t *testing.T) {
		// arrange
		var out strings.Builder

		// act
		err := WriteNote(&out, note, Options{})

		// assert
		require.NoError(t, err)
		got := out.String()
		assert.Contains(t, got, "<title>A &lt;title&gt;</title>")
		assert.Contains(t, got, `<article class="markdown-document">`+"\n"+note.HTML)
		assert.Contains(t, got, "<style>"+asset("page.css"))
		assert.Contains(t, got, string(render.ChromaCSS()))
		assert.Contains(t, got, "<script>"+asset("page.js"))
		assert.NotContains(t, got, asset("math.js"))
	})

	t.Run("the theme picker offers every theme", func(t *testing.T) {
		// arrange
		var out strings.Builder
		want := []string{`<button type="button" data-theme="auto" aria-pressed="true">Auto</button>`}
		for _, entry := range theme.All() {
			want = append(want, `<button type="button" data-theme="`+entry.ID+`" aria-pressed="false">`+entry.Name+`</button>`)
		}

		// act
		err := WriteNote(&out, note, Options{})

		// assert
		require.NoError(t, err)
		assert.Equal(t, want, regexp.MustCompile(`<button type="button" data-theme=[^>]*>[^<]*</button>`).
			FindAllString(out.String(), -1))
	})

	t.Run("the head holds the theme picker and nothing else", func(t *testing.T) {
		// arrange
		var out strings.Builder

		// act
		err := WriteNote(&out, note, Options{})

		// assert
		require.NoError(t, err)
		assert.Contains(t, out.String(), `<header class="page-head"><span></span>`)
	})

	t.Run("math brings katex inline and unchanged", func(t *testing.T) {
		// arrange
		var out strings.Builder

		// act
		err := WriteNote(&out, note, Options{Math: true})

		// assert
		require.NoError(t, err)
		assert.Contains(t, out.String(), asset("math.css"))
		assert.Contains(t, out.String(), asset("math.js"))
	})
}

func TestWriteDiff(t *testing.T) {
	file := File{
		Path: "b.md", OldPath: "a.md", Status: Renamed, OldLabel: "v1", NewLabel: "v2",
		Rows: []htmldiff.Row{
			{Kind: htmldiff.Same, Old: &htmldiff.Side{HTML: "<p>far</p>"}, New: &htmldiff.Side{HTML: "<p>far</p>"}},
			{Kind: htmldiff.Same, Old: &htmldiff.Side{HTML: "<p>near</p>"}, New: &htmldiff.Side{HTML: "<p>near</p>"}},
			{Kind: htmldiff.Added, New: &htmldiff.Side{HTML: "<p>new</p>"}},
			{Kind: htmldiff.Format, Old: &htmldiff.Side{HTML: "<p>a\nb</p>"}, New: &htmldiff.Side{HTML: "<p>a b</p>"}},
			{Kind: htmldiff.Removed, Old: &htmldiff.Side{HTML: "<p>gone</p>"}},
			{
				Kind:   htmldiff.Changed,
				Old:    &htmldiff.Side{HTML: `<p><del class="diff-del">old</del></p>`},
				New:    &htmldiff.Side{HTML: `<p><ins class="diff-ins">new</ins></p>`},
				Inline: &htmldiff.Side{HTML: `<p><del class="diff-del">old</del> <ins class="diff-ins">new</ins></p>`},
			},
		},
	}

	t.Run("a report that names no layout puts the two versions side by side", func(t *testing.T) {
		// arrange
		var out strings.Builder

		// act
		err := WriteDiff(&out, Report{Title: "v1 → v2", Context: 1, Files: []File{file}}, Options{})

		// assert
		require.NoError(t, err)
		got := out.String()
		assert.Contains(t, got, `<h1 class="page-title">v1 → v2</h1>`)
		assert.NotContains(t, got, `<ul class="page-files">`)
		assert.Contains(t, got, `<div class="page-moved">a.md → b.md</div>`)
		assert.Contains(t, got, `<div class="diff" data-layout="split">`+"\n"+
			`<div class="diff-head"><div>v1</div><div>v2</div></div>`)
		assert.Contains(t, got, `<details class="diff-fold"><summary>1 unchanged block</summary>`+"\n"+
			`<div class="diff-row" data-kind="same"><div class="diff-cell diff-old markdown-document"><p>far</p></div>`+
			`<div class="diff-cell diff-new markdown-document"><p>far</p></div></div>`)
		assert.Contains(t, got, `<div class="diff-row" data-kind="added"><div class="diff-cell diff-old diff-empty"></div>`+
			`<div class="diff-cell diff-new markdown-document"><p>new</p></div></div>`)
		assert.Contains(t, got, `<div class="diff-row" data-kind="format"><div class="diff-cell diff-old markdown-document">`+
			"<p>a\nb</p></div>"+`<div class="diff-cell diff-new markdown-document"><p>a b</p></div>`+
			`<span class="diff-tag" title="Only the markup changed">Format</span></div>`)
		assert.NotContains(t, got, `<p class="diff-labels">`)
		assert.NotContains(t, got, `<p class="diff-none">`)
	})

	t.Run("the unified layout shows the note once, each change tagged", func(t *testing.T) {
		// arrange
		var out strings.Builder

		// act
		err := WriteDiff(&out, Report{Title: "v1 → v2", Context: 1, Layout: Unified, Files: []File{file}}, Options{})

		// assert
		require.NoError(t, err)
		got := out.String()
		assert.Contains(t, got, `<div class="diff" data-layout="unified">`+"\n"+`<p class="diff-labels">v1 → v2</p>`)
		assert.NotContains(t, got, `<div class="diff-head">`)
		assert.Contains(t, got, `<details class="diff-fold"><summary>1 unchanged block</summary>`+"\n"+
			`<div class="diff-row" data-kind="same"><div class="diff-cell markdown-document"><p>far</p></div></div>`)
		assert.Contains(t, got, `<div class="diff-row" data-kind="added"><span class="diff-tag">Added</span>`+
			`<div class="diff-cell markdown-document"><p>new</p></div></div>`)
		assert.Contains(t, got, `<div class="diff-row" data-kind="format"><span class="diff-tag">Format</span>`)
		assert.Contains(t, got, `<div class="diff-row" data-kind="removed"><span class="diff-tag">Removed</span>`+
			`<div class="diff-cell markdown-document"><p>gone</p></div></div>`)
		assert.Contains(t, got, `<div class="diff-row" data-kind="changed"><span class="diff-tag">Changed</span>`+
			`<div class="diff-cell markdown-document"><p><del class="diff-del">old</del> <ins class="diff-ins">new</ins></p></div></div>`)
		assert.NotContains(t, got, `<p class="diff-none">`)
	})

	t.Run("several files get a list, and a file with no change of text says so", func(t *testing.T) {
		// arrange
		quiet := File{Path: "c.md", Status: Modified, Rows: file.Rows[3:4]}
		var out strings.Builder

		// act
		err := WriteDiff(&out, Report{Title: "t", Files: []File{file, quiet}}, Options{})

		// assert
		require.NoError(t, err)
		got := out.String()
		assert.Contains(t, got, `<li><a href="#file-0"><span class="page-status" data-status="renamed">renamed</span>`+
			`<span class="page-path">b.md</span><span class="page-counts"><b class="page-added">+1</b><b class="page-removed">-1</b><b class="page-changed">~1</b></span></a></li>`)
		assert.Contains(t, got, `<section class="page-file" id="file-1">`)
		assert.Equal(t, 1, strings.Count(got, `<p class="diff-none">`))
	})

	t.Run("no file is said as such", func(t *testing.T) {
		// arrange
		var out strings.Builder

		// act
		err := WriteDiff(&out, Report{Title: "t"}, Options{})

		// assert
		require.NoError(t, err)
		assert.Contains(t, out.String(), `<p class="page-empty">No markdown file changed.</p>`)
	})

	t.Run("a fragment is the files and nothing around them", func(t *testing.T) {
		// arrange
		var out strings.Builder

		// act
		err := WriteDiffFragment(&out, Report{Title: "t", Context: 1, Files: []File{file}})

		// assert
		require.NoError(t, err)
		got := out.String()
		assert.True(t, strings.HasPrefix(got, `<section class="page-file" id="file-0">`), got)
		assert.NotContains(t, got, "<style>")
	})
}

func TestFold(t *testing.T) {
	same := htmldiff.Row{Kind: htmldiff.Same}
	format := htmldiff.Row{Kind: htmldiff.Format}
	added := htmldiff.Row{Kind: htmldiff.Added}

	tests := []struct {
		name    string
		rows    []htmldiff.Row
		context int
		want    []segment
	}{
		{name: "nothing", want: []segment{}},
		{
			name: "no change folds everything", rows: []htmldiff.Row{same, format}, context: 1,
			want: []segment{{Folded: true, Rows: []htmldiff.Row{same, format}}},
		},
		{
			name: "context on both sides", rows: []htmldiff.Row{same, same, added, same, same}, context: 1,
			want: []segment{
				{Folded: true, Rows: []htmldiff.Row{same}},
				{Rows: []htmldiff.Row{same, added, same}},
				{Folded: true, Rows: []htmldiff.Row{same}},
			},
		},
		{
			name: "no context", rows: []htmldiff.Row{same, added, same}, context: 0,
			want: []segment{
				{Folded: true, Rows: []htmldiff.Row{same}},
				{Rows: []htmldiff.Row{added}},
				{Folded: true, Rows: []htmldiff.Row{same}},
			},
		},
		{
			name: "two changes share their context", rows: []htmldiff.Row{added, same, same, added}, context: 1,
			want: []segment{{Rows: []htmldiff.Row{added, same, same, added}}},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got := fold(tc.rows, tc.context)

			// assert
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestStylesheet(t *testing.T) {
	// act
	got := Stylesheet()

	// assert
	assert.Equal(t, asset("page.css")+"\n"+string(render.ChromaCSS()), got)
}

func marshaled(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	require.NoError(t, err)
	return data
}

func TestWriteSitePage(t *testing.T) {
	sp := SitePage{
		Title:   "A <title>",
		Assets:  "../scrawl",
		Data:    marshaled(t, map[string]string{"html": "</script><script>alert(1)</script>"}),
		Crumbs:  []Link{{Title: "Home", Href: "../index.html"}, {Title: "a & b.md"}},
		HTML:    `<h1>Head</h1>`,
		Entries: []Link{{Title: "sub", Href: "./sub/index.html"}},
	}

	t.Run("the head links every shared file and follows the system's bar color", func(t *testing.T) {
		// arrange
		var out strings.Builder

		// act
		err := WriteSitePage(&out, sp)

		// assert
		require.NoError(t, err)
		got := out.String()
		assert.Contains(t, got, "<title>A &lt;title&gt;</title>")
		assert.Equal(t, []string{
			`<link rel="icon" href="../scrawl/favicon.svg" type="image/svg+xml">`,
			`<script src="../scrawl/` + SiteBootFile + `"></script>`,
			`<link rel="stylesheet" href="../scrawl/chroma.css">`,
			`<link rel="stylesheet" href="../scrawl/` + SiteStyleFile + `">`,
			`<script defer src="../scrawl/tree.js"></script>`,
			`<script defer src="../scrawl/` + SiteScriptFile + `"></script>`,
		}, regexp.MustCompile(`<(?:link|script)[^>]* (?:href|src)="\.\./scrawl/[^"]*"[^>]*>(?:</script>)?`).FindAllString(got, -1))
		for _, scheme := range []theme.Scheme{theme.Light, theme.Dark} {
			assert.Contains(t, got, `<meta name="theme-color" content="`+theme.AutoTheme(scheme).BarColor()+
				`" media="(prefers-color-scheme: `+string(scheme)+`)">`)
		}
	})

	t.Run("the answer is carried as marshaled, and what it holds closes no script", func(t *testing.T) {
		// arrange
		var out strings.Builder

		// act
		err := WriteSitePage(&out, sp)

		// assert
		require.NoError(t, err)
		got := out.String()
		assert.Contains(t, got, `<script type="application/json" data-scrawl="page">`+string(sp.Data)+`</script>`)
		assert.NotContains(t, got, "alert(1)</script>")
	})

	t.Run("a reader without javascript gets the path, the note and the entries", func(t *testing.T) {
		// arrange
		var out strings.Builder

		// act
		err := WriteSitePage(&out, sp)

		// assert
		require.NoError(t, err)
		got := out.String()
		assert.Contains(t, got, `<ol class="scrawl-static-crumbs"><li><a href="../index.html">Home</a></li><li>a &amp; b.md</li></ol>`)
		assert.Contains(t, got, `<article class="markdown-document">`+"\n"+sp.HTML)
		assert.Contains(t, got, `<li><a href="./sub/index.html">sub</a></li>`)
	})

	t.Run("a folder with nothing to read has no article", func(t *testing.T) {
		// arrange
		var out strings.Builder
		empty := sp
		empty.HTML = ""

		// act
		err := WriteSitePage(&out, empty)

		// assert
		require.NoError(t, err)
		assert.NotContains(t, out.String(), "<article")
	})
}

func TestWriteNotFound(t *testing.T) {
	// arrange
	var out strings.Builder

	// act
	err := WriteNotFound(&out)

	// assert
	require.NoError(t, err)
	got := out.String()
	assert.Contains(t, got, "<h1>Nothing here</h1>")
	assert.NotContains(t, got, "href=")
	assert.NotContains(t, got, "src=")
}

func TestSiteAssets(t *testing.T) {
	// act
	got := SiteAssets()

	// assert
	assert.Equal(t, map[string]string{
		SiteBootFile:   asset(SiteBootFile),
		SiteScriptFile: asset(SiteScriptFile),
		SiteStyleFile:  asset(SiteStyleFile),
	}, got)
}

func TestMath(t *testing.T) {
	// act
	got := Math()

	// assert
	assert.Equal(t, map[string]string{MathScriptFile: asset("math.js"), MathStyleFile: asset("math.css")}, got)
}

func TestShownOf(t *testing.T) {
	old, cur, inline := &htmldiff.Side{HTML: "<p>a</p>"}, &htmldiff.Side{HTML: "<p>b</p>"}, &htmldiff.Side{HTML: "<p>ab</p>"}
	tests := []struct {
		name string
		row  htmldiff.Row
		want []*htmldiff.Side
	}{
		{name: "a removed block as it was", row: htmldiff.Row{Kind: htmldiff.Removed, Old: old}, want: []*htmldiff.Side{old}},
		{name: "a changed block in one", row: htmldiff.Row{Kind: htmldiff.Changed, Old: old, New: cur, Inline: inline},
			want: []*htmldiff.Side{inline}},
		{name: "a changed block too long to join", row: htmldiff.Row{Kind: htmldiff.Changed, Old: old, New: cur},
			want: []*htmldiff.Side{old, cur}},
		{name: "a block as it is now", row: htmldiff.Row{Kind: htmldiff.Format, Old: old, New: cur}, want: []*htmldiff.Side{cur}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act & assert
			assert.Equal(t, tc.want, shownOf(tc.row))
		})
	}
}
