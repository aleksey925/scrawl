package render

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSanitizeNeutralisesMaliciousDocument(t *testing.T) {
	// arrange
	src, err := os.ReadFile(filepath.Join("testdata", "md", "malicious.md"))
	require.NoError(t, err)

	// act
	out, err := New(Options{}).RenderInline(src, "docs/malicious.md")
	require.NoError(t, err)

	// assert
	for _, forbidden := range []string{
		"<script", "</script", "alert", "<style", "<iframe", "<object", "<form",
		"<input", "<svg", "onerror", "onclick", "onload", "javascript:",
		"data:text/html", "data:image/svg", "position:fixed", "внутренняя заметка",
	} {
		assert.NotContains(t, string(out), forbidden, forbidden)
	}
}

func TestSanitizeKeeps(t *testing.T) {
	tests := []struct{ name, src, want string }{
		{"manual anchor", "<a name='Общее'></a>\n", `<a name="Общее"></a>`},
		{"heading id", "## Настройка сервера\n", `<h2 id="настройка-сервера">`},
		{"details and summary", "<details open>\n<summary>S</summary>\n\nx\n\n</details>\n", `<details open="">`},
		{"chroma classes", "```go\nfunc main() {}\n```\n", `<span class="kd">`},
		{"code block language hook", "```python\nx = 1\n```\n", `<div class="code-block" data-lang="python">`},
		{"task list", "- [x] done\n", `<input checked="" disabled="" type="checkbox">`},
		{"table alignment", "| a |\n|:-:|\n| b |\n", `<th align="center">`},
		{"kbd and mark", "<kbd>K</kbd> <mark>m</mark>\n", "<kbd>K</kbd> <mark>m</mark>"},
		{"sup and sub", "x<sup>2</sup> H<sub>2</sub>O\n", "<sup>2</sup>"},
		{"thematic break", "a\n\n---\n\nb\n", "<hr>"},
		{"ordered list start", "5. пятый\n", `<ol start="5">`},
		{"hard break", "a  \nb\n", "<br>"},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := r.RenderInline([]byte(tt.src), "docs/x.md")
			require.NoError(t, err)
			assert.Contains(t, string(out), tt.want)
		})
	}
}

func TestSanitizeIDAttribute(t *testing.T) {
	tests := []struct {
		name, src string
		want      bool
	}{
		{name: "slug", src: `<a id="общее-1">x</a>`, want: true},
		{name: "quote breakout attempt", src: `<a id='z"onmouseover="alert(1)'>x</a>`},
		{name: "spaces", src: `<a id="a b c">x</a>`},
		{name: "app element id is still just an id", src: `<a id="palette">x</a>`, want: true},
		{name: "leading dash", src: `<a id="-x">x</a>`},
	}
	r := New(Options{})

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			out, err := r.RenderInline([]byte(tc.src), "x.md")

			// assert
			require.NoError(t, err)
			assert.Equal(t, tc.want, strings.Contains(string(out), "id="), "output: %s", out)
		})
	}
}

func TestSanitizeDropsGlobalAttributesTheCorpusDoesNotUse(t *testing.T) {
	// act
	out, err := New(Options{}).RenderInline([]byte(`<p title="tip" dir="rtl" lang="en">x</p>`), "x.md")

	// assert
	require.NoError(t, err)
	assert.Equal(t, "<p>x</p>", string(out))
}

func TestSanitizeStripsMarkdownAttribute(t *testing.T) {
	// act
	out, err := New(Options{}).RenderInline([]byte("<details markdown=\"span\">\n<summary>S</summary>\n\nx\n\n</details>\n"), "x.md")

	// assert
	require.NoError(t, err)
	assert.NotContains(t, string(out), "markdown=")
	assert.Contains(t, string(out), "<details>")
}

func TestSanitizeDropsDataImageURLs(t *testing.T) {
	tests := []struct{ name, src string }{
		{"markdown image", "![](data:image/png;base64,iVBORw0KGgo=)"},
		{"raw html image", `<img src="data:image/svg+xml;base64,PHN2Zz4=">`},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := r.RenderInline([]byte(tt.src), "x.md")
			require.NoError(t, err)
			assert.NotContains(t, string(out), "data:")
		})
	}
}

func TestStripAnchorParagraphs(t *testing.T) {
	tests := []struct{ name, in, want string }{
		{"single anchor", `<p><a name="Общее"></a></p>`, `<a name="Общее"></a>`},
		{"two anchors", `<p><a name="a"></a>` + "\n" + `<a name="b"></a></p>`, `<a name="a"></a>` + "\n" + `<a name="b"></a>`},
		{"anchor with text is kept", `<p><a name="a"></a>текст</p>`, `<p><a name="a"></a>текст</p>`},
		{"plain paragraph", `<p>текст</p>`, `<p>текст</p>`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, string(stripAnchorParagraphs([]byte(tt.in))))
		})
	}
}

func TestRenderAnchorAboveHeadingHasNoEmptyParagraph(t *testing.T) {
	// act
	out, err := New(Options{}).RenderInline([]byte("<a name='Общее'></a>\n## Общее\n"), "x.md")

	// assert
	require.NoError(t, err)
	assert.Equal(t, `<a name="Общее"></a>`+"\n"+`<h2 id="общее">Общее</h2>`+"\n", string(out))
}

func TestRenderInlineCodeWithAngleBrackets(t *testing.T) {
	// act
	out, err := New(Options{}).RenderInline([]byte("`docker logs --tail 100 <id>`\n"), "x.md")

	// assert
	require.NoError(t, err)
	assert.Contains(t, string(out), "<code>docker logs --tail 100 &lt;id&gt;</code>")
}

func TestRenderPreservesInvisibleCharacters(t *testing.T) {
	// arrange
	src, err := os.ReadFile(filepath.Join("testdata", "md", "invisible-spaces.md"))
	require.NoError(t, err)

	// act
	out, err := New(Options{}).RenderInline(src, "docs/invisible-spaces.md")

	// assert
	require.NoError(t, err)
	assert.Equal(t, strings.Count(string(src), "\u00a0"), strings.Count(string(out), "\u00a0"))
	assert.Equal(t, strings.Count(string(src), "\u200b"), strings.Count(string(out), "\u200b"))
}
