package render

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDiagramFences(t *testing.T) {
	tests := []struct{ name, src, want string }{
		{"diagram source is handed over verbatim", "```mermaid\ngraph TD;\n  A-->B;\n```\n",
			"<pre class=\"mermaid\">graph TD;\n  A--&gt;B;\n</pre>\n"},
		{"the language is matched case-insensitively", "```Mermaid\nx\n```\n", `<pre class="mermaid">`},
		{"an info string after the language still counts", "```mermaid title=x\ny\n```\n", `<pre class="mermaid">`},
		{"plantuml source is handed over verbatim", "```plantuml\n@startuml\nA -> B : <b>hi</b>\n@enduml\n```\n",
			"<pre class=\"plantuml\">@startuml\nA -&gt; B : &lt;b&gt;hi&lt;/b&gt;\n@enduml\n</pre>\n"},
		{"puml is plantuml too", "```puml\nA -> B\n```\n", `<pre class="plantuml">`},
		{"plantuml is matched case-insensitively", "```PlantUML\nA -> B\n```\n", `<pre class="plantuml">`},
		{"any other fence is highlighted as before", "```go\nfunc main() {}\n```\n",
			`<div class="code-block" data-lang="go">`},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// act
			out, err := r.RenderInline([]byte(tt.src), "docs/x.md")

			// assert
			require.NoError(t, err)
			assert.Contains(t, withoutSourceRanges(string(out)), tt.want)
		})
	}
}

func TestRenderReportsDiagrams(t *testing.T) {
	type diagrams struct{ mermaid, plantUML bool }
	tests := []struct {
		name string
		src  string
		want diagrams
	}{
		{name: "a mermaid fence", src: "# A\n\n```mermaid\ngraph TD;\n```\n", want: diagrams{mermaid: true}},
		{name: "a plantuml fence", src: "# A\n\n```plantuml\nA -> B\n```\n", want: diagrams{plantUML: true}},
		{name: "a puml fence", src: "```puml\nA -> B\n```\n", want: diagrams{plantUML: true}},
		{
			name: "both kinds",
			src:  "```mermaid\ngraph TD;\n```\n\n```plantuml\nA -> B\n```\n",
			want: diagrams{mermaid: true, plantUML: true},
		},
		{name: "code that names them", src: "```go\n// mermaid plantuml\n```\n", want: diagrams{}},
		{name: "no fence at all", src: "# A\n\ntext\n", want: diagrams{}},
	}
	r := New(Options{})
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			res, err := r.Render([]byte(tc.src), "a.md")

			// assert
			require.NoError(t, err)
			assert.Equal(t, tc.want, diagrams{mermaid: res.Mermaid, plantUML: res.PlantUML})
		})
	}
}

func TestDiagramFenceIsNeverHighlighted(t *testing.T) {
	for _, lang := range []string{"mermaid", "plantuml", "puml"} {
		t.Run(lang, func(t *testing.T) {
			// act
			out, err := New(Options{}).RenderInline([]byte("```"+lang+"\nA -> B;\n```\n"), "docs/x.md")

			// assert
			require.NoError(t, err)
			assert.NotContains(t, string(out), "chroma")
			assert.NotContains(t, string(out), "code-block")
		})
	}
}

func TestEmojiShortcodes(t *testing.T) {
	tests := []struct{ name, src, want string }{
		{"known shortcode", ":tada:\n", "<p>🎉</p>"},
		{"shortcode with a plus", ":+1:\n", "<p>👍</p>"},
		{"unknown shortcode", ":nosuchemojiname:\n", "<p>:nosuchemojiname:</p>"},
		{"a colon in prose", "время 10:30 и a:b\n", "<p>время 10:30 и a:b</p>"},
		{"empty pair of colons", "::\n", "<p>::</p>"},
		{"code span", "`:tada:`\n", "<p><code>:tada:</code></p>"},
		{"fence", "```text\n:tada:\n```\n", ":tada:\n"},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := r.RenderInline([]byte(tt.src), "docs/x.md")
			require.NoError(t, err)
			assert.Contains(t, withoutSourceRanges(string(out)), tt.want)
		})
	}
}

func TestRenderReportsMath(t *testing.T) {
	tests := []struct {
		name string
		src  string
		want bool
	}{
		{name: "an inline formula", src: "a $x^2$ b\n", want: true},
		{name: "a display block", src: "$$\nx\n$$\n", want: true},
		{name: "a math fence", src: "```math\nx\n```\n", want: true},
		{name: "raw html of the class", src: "<span class=\"big math\">x</span>\n", want: true},
		{name: "a class that only starts with it", src: "<span class=\"mathematics\">x</span>\n", want: false},
		{name: "a dollar amount", src: "it costs $5\n", want: false},
	}
	r := New(Options{})
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			res, err := r.Render([]byte(tc.src), "a.md")

			// assert
			require.NoError(t, err)
			assert.Equal(t, tc.want, res.Math)
		})
	}
}
