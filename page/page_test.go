package page

import (
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
		},
	}

	t.Run("a page draws the rows the way the app does", func(t *testing.T) {
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
		assert.Contains(t, got, `<div class="diff-head"><div>v1</div><div>v2</div></div>`)
		assert.Contains(t, got, `<details class="diff-fold"><summary>1 unchanged block</summary>`+"\n"+
			`<div class="diff-row" data-kind="same"><div class="diff-cell diff-old markdown-document"><p>far</p></div>`)
		assert.Contains(t, got, `<div class="diff-row" data-kind="added"><div class="diff-cell diff-old diff-empty"></div>`+
			`<div class="diff-cell diff-new markdown-document"><p>new</p></div></div>`)
		assert.Contains(t, got, `<span class="diff-badge" title="Only the markup changed">format</span>`)
		assert.NotContains(t, got, `<p class="diff-none">`)
	})

	t.Run("several files get a list, and a file with no change of text says so", func(t *testing.T) {
		// arrange
		quiet := File{Path: "c.md", Status: Modified, Rows: file.Rows[3:]}
		var out strings.Builder

		// act
		err := WriteDiff(&out, Report{Title: "t", Files: []File{file, quiet}}, Options{})

		// assert
		require.NoError(t, err)
		got := out.String()
		assert.Contains(t, got, `<li><a href="#file-0"><span class="page-status" data-status="renamed">renamed</span>`+
			`<span class="page-path">b.md</span><span class="page-counts"><b class="page-added">+1</b></span></a></li>`)
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
