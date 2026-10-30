package render

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDiagramBlocks(t *testing.T) {
	type found struct{ block, source string }
	tests := []struct {
		name     string
		fragment string
		want     []found
	}{
		{
			name:     "a fence",
			fragment: `<p>x</p><pre class="plantuml" data-source-start="3">A -&gt; B</pre>` + "\n",
			want:     []found{{block: `<pre class="plantuml" data-source-start="3">A -&gt; B</pre>`, source: "A -&gt; B"}},
		},
		{
			name:     "the class among others",
			fragment: `<pre id="a" class="note plantuml wide">A</pre>`,
			want:     []found{{block: `<pre id="a" class="note plantuml wide">A</pre>`, source: "A"}},
		},
		{
			name:     "two blocks and code between them",
			fragment: `<pre class="plantuml">A</pre><pre><code>x</code></pre><pre class="plantuml">B</pre>`,
			want: []found{
				{block: `<pre class="plantuml">A</pre>`, source: "A"},
				{block: `<pre class="plantuml">B</pre>`, source: "B"},
			},
		},
		{name: "a class that only starts with the name", fragment: `<pre class="plantuml-source">A</pre>`},
		{name: "another attribute that holds the name", fragment: `<pre data-class="plantuml">A</pre>`},
		{name: "another element with the class", fragment: `<div class="plantuml">A</div>`},
		{name: "a tag that only starts with pre", fragment: `<prefix class="plantuml">A</prefix>`},
		{name: "a block that is not closed", fragment: `<pre class="plantuml">A`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			blocks := DiagramBlocks(tc.fragment, PlantUMLClass)

			// assert
			var got []found
			for _, entry := range blocks {
				got = append(got, found{block: tc.fragment[entry.Start:entry.End], source: entry.Source})
			}
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestDiagramBlockText(t *testing.T) {
	tests := []struct {
		name   string
		source string
		want   string
	}{
		{
			name:   "entities",
			source: "!include &lt;C4/C4_Context&gt;\nA -&gt; B : &quot;x&quot; &amp; &#39;y&#39;",
			want:   "!include <C4/C4_Context>\nA -> B : \"x\" & 'y'",
		},
		{
			name:   "child markup",
			source: `<code class="x">A -&gt; B : <b>bold</b></code>` + "\n<span>&lt;b&gt;</span>",
			want:   "A -> B : bold\n<b>",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			text := DiagramBlock{Source: tc.source}.Text()

			// assert
			assert.Equal(t, tc.want, text)
		})
	}
}

func TestDiagramBlockTextOfARawBlockWithCode(t *testing.T) {
	// arrange
	res, err := New(Options{}).Render([]byte("<pre class=\"plantuml\"><code>Alice -&gt; Bob</code></pre>\n"), "a.md")
	require.NoError(t, err)

	// act
	blocks := DiagramBlocks(string(res.HTML), PlantUMLClass)

	// assert
	require.Len(t, blocks, 1)
	assert.Equal(t, "Alice -> Bob", blocks[0].Text())
}
