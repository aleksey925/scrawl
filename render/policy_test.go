package render

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/net/html"
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

// TestSanitizeNeutralisesMaliciousGFMDocument covers the markup the GFM
// extensions add: every one of them carries author-written content into the
// page, and none of it may become an element.
func TestSanitizeNeutralisesMaliciousGFMDocument(t *testing.T) {
	// arrange
	src, err := os.ReadFile(filepath.Join("testdata", "md", "malicious-gfm.md"))
	require.NoError(t, err)

	// act
	out, err := New(Options{}).RenderInline(src, "docs/malicious-gfm.md")
	require.NoError(t, err)

	// assert
	elements, attrs := collectTags(t, string(out))
	assert.Equal(t, []string{"a", "blockquote", "div", "h1", "h2", "li", "ol", "p", "pre", "section", "span", "sup"},
		elements)
	assert.Equal(t, []string{"class", "href", "id"}, attrs)
}

// collectTags returns the sorted, deduplicated element and attribute names of a
// fragment. Asserting on the whole set is the only way to see that author
// content stayed content: a substring check cannot tell "<script" inside a text
// node apart from a real element.
func collectTags(t *testing.T, fragment string) (elements, attrs []string) {
	t.Helper()
	seenElements, seenAttrs := map[string]struct{}{}, map[string]struct{}{}
	z := html.NewTokenizer(strings.NewReader(fragment))
	for {
		switch z.Next() {
		case html.ErrorToken:
			for name := range seenElements {
				elements = append(elements, name)
			}
			for name := range seenAttrs {
				attrs = append(attrs, name)
			}
			sort.Strings(elements)
			sort.Strings(attrs)
			return elements, attrs
		case html.StartTagToken, html.SelfClosingTagToken:
			tok := z.Token()
			seenElements[tok.Data] = struct{}{}
			for _, attr := range tok.Attr {
				seenAttrs[attr.Key] = struct{}{}
			}
		}
	}
}

func TestSanitizeEscapesRawContentInsteadOfDroppingIt(t *testing.T) {
	tests := []struct{ name, src, want string }{
		{"inline math", "$</span><b>x</b>$\n", `<span class="math math-inline">&lt;/span&gt;&lt;b&gt;x&lt;/b&gt;</span>`},
		{"display math", "$$\n</div><b>x</b>\n$$\n", `<div class="math math-display">&lt;/div&gt;&lt;b&gt;x&lt;/b&gt;` + "\n</div>"},
		{"mermaid", "```mermaid\n</pre><b>x</b>\n```\n", `<pre class="mermaid">&lt;/pre&gt;&lt;b&gt;x&lt;/b&gt;` + "\n</pre>"},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := r.RenderInline([]byte(tt.src), "x.md")
			require.NoError(t, err)
			assert.Contains(t, string(out), tt.want)
		})
	}
}

func TestSanitizeSourceElement(t *testing.T) {
	tests := []struct {
		name, src string
		want      bool
	}{
		{name: "relative srcset", src: `<source srcset="a.png">`, want: true},
		{name: "srcset with descriptors", src: `<source srcset="a.png 1x, b.png 2x">`, want: true},
		{name: "https srcset", src: `<source srcset="https://example.com/a.png">`, want: true},
		{name: "javascript srcset", src: `<source srcset="javascript:alert(1)">`},
		{name: "data srcset", src: `<source srcset="data:image/svg+xml;base64,PHN2Zz4=">`},
		{name: "quote breakout attempt", src: `<source srcset="a.png&quot; onload=&quot;alert(1)">`},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// act
			out, err := r.RenderInline([]byte(tt.src), "x.md")

			// assert
			require.NoError(t, err)
			assert.Equal(t, tt.want, strings.Contains(string(out), "srcset="), "output: %s", out)
		})
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
		{"alert", "> [!NOTE]\n> x\n", `<div class="alert alert-note">`},
		{"footnote section", "x[^1]\n\n[^1]: y\n", `<section class="footnotes">`},
		{"inline math", "$x$\n", `<span class="math math-inline">x</span>`},
		{"display math", "$$\nx\n$$\n", `<div class="math math-display">`},
		{"mermaid", "```mermaid\nx\n```\n", `<pre class="mermaid">`},
		{"theme image", "<picture><source media=\"(prefers-color-scheme: dark)\" srcset=\"d.png\"><img src=\"l.png\"></picture>\n",
			`<source media="(prefers-color-scheme: dark)" srcset="/raw/docs/d.png">`},
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
