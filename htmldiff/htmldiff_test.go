package htmldiff

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/render"
)

func TestDiff(t *testing.T) {
	tests := []struct {
		name string
		old  string
		cur  string
		want []Row
	}{
		{
			name: "identical",
			old:  "<p>one</p>\n<p>two</p>",
			cur:  "<p>one</p>\n<p>two</p>",
			want: []Row{
				{Kind: Same, Old: &Side{HTML: "<p>one</p>"}, New: &Side{HTML: "<p>one</p>"}},
				{Kind: Same, Old: &Side{HTML: "<p>two</p>"}, New: &Side{HTML: "<p>two</p>"}},
			},
		},
		{
			name: "markup only",
			old:  "<p>a <em>word</em></p>",
			cur:  "<p>a <i>word</i></p>",
			want: []Row{
				{Kind: Format, Old: &Side{HTML: "<p>a <em>word</em></p>"}, New: &Side{HTML: "<p>a <i>word</i></p>"}},
			},
		},
		{
			name: "a word replaced",
			old:  "<p>the quick fox</p>",
			cur:  "<p>the slow fox</p>",
			want: []Row{{
				Kind: Changed,
				Old:  &Side{HTML: `<p>the <del class="diff-del">quick</del> fox</p>`},
				New:  &Side{HTML: `<p>the <ins class="diff-ins">slow</ins> fox</p>`},
			}},
		},
		{
			name: "neighboring words marked as one run",
			old:  "<p>keep this and that</p>",
			cur:  "<p>keep</p>",
			want: []Row{{
				Kind: Changed,
				Old:  &Side{HTML: `<p>keep <del class="diff-del">this and that</del></p>`},
				New:  &Side{HTML: `<p>keep</p>`},
			}},
		},
		{
			name: "block added and removed",
			old:  "<p>first</p>\n<p>gone entirely</p>",
			cur:  "<p>first</p>\n<h2>brand new heading</h2>",
			want: []Row{
				{Kind: Same, Old: &Side{HTML: "<p>first</p>"}, New: &Side{HTML: "<p>first</p>"}},
				{Kind: Removed, Old: &Side{HTML: "<p>gone entirely</p>"}},
				{Kind: Added, New: &Side{HTML: "<h2>brand new heading</h2>"}},
			},
		},
		{
			name: "heading renamed",
			old:  "<h1>Python</h1>",
			cur:  "<h1>Питон</h1>",
			want: []Row{{
				Kind: Changed,
				Old:  &Side{HTML: `<h1><del class="diff-del">Python</del></h1>`},
				New:  &Side{HTML: `<h1><ins class="diff-ins">Питон</ins></h1>`},
			}},
		},
		{
			name: "added block before a changed one",
			old:  "<p>alpha beta gamma delta</p>",
			cur:  "<p>inserted</p>\n<p>alpha beta gamma epsilon</p>",
			want: []Row{
				{Kind: Added, New: &Side{HTML: "<p>inserted</p>"}},
				{
					Kind: Changed,
					Old:  &Side{HTML: `<p>alpha beta gamma <del class="diff-del">delta</del></p>`},
					New:  &Side{HTML: `<p>alpha beta gamma <ins class="diff-ins">epsilon</ins></p>`},
				},
			},
		},
		{
			name: "link pointing elsewhere",
			old:  `<p>see <a href="/a.md">docs</a></p>`,
			cur:  `<p>see <a href="/b.md">docs</a></p>`,
			want: []Row{{
				Kind: Changed,
				Old:  &Side{HTML: `<p>see <a href="/a.md" class="diff-del">docs</a></p>`},
				New:  &Side{HTML: `<p>see <a href="/b.md" class="diff-ins">docs</a></p>`},
			}},
		},
		{
			name: "picture swapped",
			old:  `<p><img src="a.png" alt="x" class="wide"/></p>`,
			cur:  `<p><img src="b.png" alt="x" class="wide"/></p>`,
			want: []Row{{
				Kind: Changed,
				Old:  &Side{HTML: `<p><img src="a.png" alt="x" class="wide diff-del"/></p>`},
				New:  &Side{HTML: `<p><img src="b.png" alt="x" class="wide diff-ins"/></p>`},
			}},
		},
		{
			name: "indent of code",
			old:  "<pre><code>if x:\n  y()\n</code></pre>",
			cur:  "<pre><code>if x:\n    y()\n</code></pre>",
			want: []Row{{
				Kind: Changed,
				Old:  &Side{HTML: "<pre><code>if x:\n<del class=\"diff-del\">  </del>y()\n</code></pre>"},
				New:  &Side{HTML: "<pre><code>if x:\n<ins class=\"diff-ins\">    </ins>y()\n</code></pre>"},
			}},
		},
		{
			name: "whitespace outside code",
			old:  "<p>one\ntwo</p>",
			cur:  "<p>one two</p>",
			want: []Row{
				{Kind: Format, Old: &Side{HTML: "<p>one\ntwo</p>"}, New: &Side{HTML: "<p>one two</p>"}},
			},
		},
		{
			name: "source lines kept, volatile attributes dropped",
			old:  `<h2 id="intro" data-source-start="1" data-source-end="1">Intro</h2>`,
			cur:  `<p>new</p><h2 id="intro" data-source-start="3" data-source-end="4">Intro</h2>`,
			want: []Row{
				{Kind: Added, New: &Side{HTML: "<p>new</p>"}},
				{
					Kind: Same,
					Old:  &Side{HTML: "<h2>Intro</h2>", Start: 1, End: 1},
					New:  &Side{HTML: "<h2>Intro</h2>", Start: 3, End: 4},
				},
			},
		},
		{
			name: "details opened",
			old:  "<details><summary>more</summary><p>hidden</p></details>",
			cur:  "<details><summary>more</summary><p>hidden</p></details>",
			want: []Row{{
				Kind: Same,
				Old:  &Side{HTML: "<details open=\"\"><summary>more</summary><p>hidden</p></details>"},
				New:  &Side{HTML: "<details open=\"\"><summary>more</summary><p>hidden</p></details>"},
			}},
		},
		{
			name: "bare text and empty paragraphs",
			old:  "loose text<p></p>",
			cur:  "loose text",
			want: []Row{
				{Kind: Same, Old: &Side{HTML: "<p>loose text</p>"}, New: &Side{HTML: "<p>loose text</p>"}},
			},
		},
		{
			name: "cyrillic words",
			old:  "<p>привет, мир</p>",
			cur:  "<p>привет, город</p>",
			want: []Row{{
				Kind: Changed,
				Old:  &Side{HTML: `<p>привет, <del class="diff-del">мир</del></p>`},
				New:  &Side{HTML: `<p>привет, <ins class="diff-ins">город</ins></p>`},
			}},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got, err := Diff(Document{HTML: tc.old}, Document{HTML: tc.cur})

			// assert
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestDiffFrontmatter(t *testing.T) {
	// arrange
	old := Document{Frontmatter: "---\ntitle: a\n---\n", HTML: "<p>body</p>"}
	cur := Document{Frontmatter: "---\ntitle: b\n---\n", HTML: "<p>body</p>"}

	// act
	got, err := Diff(old, cur)

	// assert
	require.NoError(t, err)
	assert.Equal(t, []Row{
		{
			Kind: Changed,
			Old: &Side{
				HTML:  "<pre class=\"frontmatter\"><code>---\ntitle: <del class=\"diff-del\">a</del>\n---</code></pre>",
				Start: 1, End: 3,
			},
			New: &Side{
				HTML:  "<pre class=\"frontmatter\"><code>---\ntitle: <ins class=\"diff-ins\">b</ins>\n---</code></pre>",
				Start: 1, End: 3,
			},
		},
		{Kind: Same, Old: &Side{HTML: "<p>body</p>"}, New: &Side{HTML: "<p>body</p>"}},
	}, got)
}

func TestDiffTooManyWords(t *testing.T) {
	// arrange
	words := strings.Repeat("w ", maxTokens)
	old := "<p>" + words + "end</p>"
	cur := "<p>" + words + "finish</p>"

	// act
	got, err := Diff(Document{HTML: old}, Document{HTML: cur})

	// assert
	require.NoError(t, err)
	assert.Equal(t, []Row{{Kind: Changed, Old: &Side{HTML: old}, New: &Side{HTML: cur}}}, got)
}

func TestDiffEscapesText(t *testing.T) {
	// arrange
	old := "<p>a &lt;b&gt; c</p>"
	cur := "<p>a &lt;i&gt; c</p>"

	// act
	got, err := Diff(Document{HTML: old}, Document{HTML: cur})

	// assert
	require.NoError(t, err)
	assert.Equal(t, []Row{{
		Kind: Changed,
		Old:  &Side{HTML: `<p>a &lt;<del class="diff-del">b</del>&gt; c</p>`},
		New:  &Side{HTML: `<p>a &lt;<ins class="diff-ins">i</ins>&gt; c</p>`},
	}}, got)
}

func TestCount(t *testing.T) {
	// arrange
	rows := []Row{{Kind: Same}, {Kind: Format}, {Kind: Added}, {Kind: Added}, {Kind: Removed}, {Kind: Changed}}

	// act
	got := Count(rows)

	// assert
	assert.Equal(t, Stats{Added: 2, Removed: 1, Changed: 1}, got)
	assert.False(t, got.Empty())
	assert.True(t, Count([]Row{{Kind: Same}, {Kind: Format}}).Empty())
}

func TestSimilarity(t *testing.T) {
	tests := []struct {
		name string
		a, b string
		want float64
	}{
		{name: "both empty", want: 1},
		{name: "one empty", a: "x", want: 0},
		{name: "same words", a: "A b", b: "a B", want: 1},
		{name: "half", a: "a b", b: "a c", want: 0.5},
		{name: "repetitions counted", a: "a a", b: "a", want: 2.0 / 3},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got := similarity(tc.a, tc.b)

			// assert
			assert.InDelta(t, tc.want, got, 1e-9)
		})
	}
}

func TestDiffRenderedNotes(t *testing.T) {
	// arrange
	r := render.New(render.Options{})
	old := "# Title\n\nA long line that\nwraps here.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nThe quick fox.\n"
	cur := "# Title\n\nA long line that wraps here.\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\nThe slow fox.\n"
	oldRes, err := r.Render([]byte(old), "n.md")
	require.NoError(t, err)
	curRes, err := r.Render([]byte(cur), "n.md")
	require.NoError(t, err)

	// act
	got, err := Diff(Document{HTML: string(oldRes.HTML)}, Document{HTML: string(curRes.HTML)})

	// assert
	require.NoError(t, err)
	kinds := make([]Kind, 0, len(got))
	for _, row := range got {
		kinds = append(kinds, row.Kind)
	}
	assert.Equal(t, []Kind{Same, Format, Same, Changed}, kinds)
	assert.Equal(t, Side{HTML: `<p>The <ins class="diff-ins">slow</ins> fox.</p>`, Start: 9, End: 9}, *got[3].New)
}
