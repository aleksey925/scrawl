package render

import (
	"testing"

	"github.com/stretchr/testify/assert"
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
	// arrange
	block := DiagramBlock{Source: "!include &lt;C4/C4_Context&gt;\nA -&gt; B : &quot;x&quot; &amp; &#39;y&#39;"}

	// act
	text := block.Text()

	// assert
	assert.Equal(t, "!include <C4/C4_Context>\nA -> B : \"x\" & 'y'", text)
}
