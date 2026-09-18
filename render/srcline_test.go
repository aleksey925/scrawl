package render

import (
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/net/html"
)

var reSourceRange = regexp.MustCompile(` ` + srcStartAttr + `="\d+" ` + srcEndAttr + `="\d+"`)

// withoutSourceRanges strips the source range out of a fragment, for the
// assertions that are about the shape of the output rather than the mapping.
func withoutSourceRanges(fragment string) string {
	return reSourceRange.ReplaceAllString(fragment, "")
}

// sourceRanges lists every element carrying a source range, in document order,
// as "element:start-end".
func sourceRanges(t *testing.T, fragment string) []string {
	t.Helper()
	var out []string
	z := html.NewTokenizer(strings.NewReader(fragment))
	for {
		switch z.Next() {
		case html.ErrorToken:
			return out
		case html.StartTagToken, html.SelfClosingTagToken:
			tok := z.Token()
			start, end := "", ""
			for _, attr := range tok.Attr {
				switch attr.Key {
				case srcStartAttr:
					start = attr.Val
				case srcEndAttr:
					end = attr.Val
				}
			}
			if start != "" || end != "" {
				out = append(out, tok.Data+":"+start+"-"+end)
			}
		}
	}
}

const (
	plainDoc  = "# Заголовок\n\nАбзац.\n\n- один\n- два\n\n---\n\n> цитата\n"
	nestedDoc = "- один\n    - вложенный\n    - второй\n- два\n\n      текст\n"
	fencesDoc = "# H\n\n```go\nfunc a() {}\nfunc b() {}\n```\n\n```\nno lang\n```\n\n    indented\n    code\n"
	tableDoc  = "текст\n\n| a | b |\n|:-:|--:|\n| 1 | 2 |\n| 3 | 4 |\n\nхвост\n"
	mathDoc   = "# M\n\n$$\na + b\nc + d\n$$\n\n$$x = y$$\n\n```math\n\\int\n```\n\n```mermaid\ngraph TD;\nA-->B;\n```\n"
	alertDoc  = "# A\n\n> [!NOTE]\n> первая\n> вторая\n\nхвост\n"
)

func TestSourceRanges(t *testing.T) {
	tests := []struct {
		name, src string
		want      []string
	}{
		{
			name: "plain document",
			src:  plainDoc,
			want: []string{"h1:1-1", "p:3-3", "ul:5-6", "li:5-5", "li:6-6", "hr:8-8", "blockquote:10-10", "p:10-10"},
		},
		{
			name: "frontmatter shifts every block onto its original line",
			src:  "---\ntitle: x\ntags: [a]\n---\n" + plainDoc,
			want: []string{"h1:5-5", "p:7-7", "ul:9-10", "li:9-9", "li:10-10", "hr:12-12", "blockquote:14-14", "p:14-14"},
		},
		{
			name: "frontmatter closed with dots",
			src:  "---\ntitle: x\n...\n" + plainDoc,
			want: []string{"h1:4-4", "p:6-6", "ul:8-9", "li:8-8", "li:9-9", "hr:11-11", "blockquote:13-13", "p:13-13"},
		},
		{
			name: "nested lists",
			src:  nestedDoc,
			want: []string{"ul:1-6", "li:1-3", "p:1-1", "ul:2-3", "li:2-2", "li:3-3", "li:4-6", "p:4-4", "div:6-6"},
		},
		{
			name: "code fences span their markers",
			src:  fencesDoc,
			want: []string{"h1:1-1", "div:3-6", "div:8-10", "div:12-13"},
		},
		{
			name: "table wrapper covers the whole table",
			src:  tableDoc,
			want: []string{"p:1-1", "div:3-6", "p:8-8"},
		},
		{
			name: "math and mermaid blocks",
			src:  mathDoc,
			want: []string{"h1:1-1", "div:3-6", "div:8-8", "div:10-12", "pre:14-17"},
		},
		{
			name: "alert starts on its marker line",
			src:  alertDoc,
			want: []string{"h1:1-1", "div:3-5", "p:4-5", "p:7-7"},
		},
		{
			name: "details block",
			src:  "# D\n\n<details markdown=\"span\">\n<summary>S</summary>\nВнутри *курсив*\n</details>\n\nхвост\n",
			want: []string{"h1:1-1", "details:3-4", "p:5-5", "p:8-8"},
		},
		{
			name: "pymd blank line before an interrupting ordered list",
			src:  "Абзац текста.\n3. Третий\n4. Четвёртый\n\nхвост\n",
			want: []string{"p:1-1", "ol:2-3", "li:2-2", "li:3-3", "p:5-5"},
		},
		{
			name: "pymd heading unwrapped inside a list item",
			src:  "# T\n\n1. <h3>[Принципы](#Принципы)</h3>\n2. обычный\n",
			want: []string{"h1:1-1", "ol:3-4", "li:3-3", "li:4-4"},
		},
		{
			name: "frontmatter and pymd rewrites together",
			src:  "---\ntitle: x\n---\nАбзац текста.\n3. Третий\n4. Четвёртый\n\n<details>\nтекст\n</details>\n",
			want: []string{"p:4-4", "ol:5-6", "li:5-5", "li:6-6", "details:8-8", "p:9-9"},
		},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// act
			out, err := r.RenderInline([]byte(tt.src), "docs/x.md")

			// assert
			require.NoError(t, err)
			assert.Equal(t, tt.want, sourceRanges(t, string(out)))
		})
	}
}

func TestSourceRangeInEditorPreview(t *testing.T) {
	// arrange
	src := []byte("---\ntitle: x\n---\n" + plainDoc + mathDoc + alertDoc)
	r := New(Options{})

	// act
	full, err := r.Render(src, "docs/x.md")
	require.NoError(t, err)
	preview, err := r.RenderInline(src, "docs/x.md")

	// assert
	require.NoError(t, err)
	assert.Equal(t, sourceRanges(t, string(full.HTML)), sourceRanges(t, string(preview)))
	assert.NotEmpty(t, sourceRanges(t, string(preview)))
}

func TestSourceRangeSanitizer(t *testing.T) {
	tests := []struct {
		name, src string
		want      []string
	}{
		{
			name: "numeric range on a block element",
			src:  `<p data-source-start="12" data-source-end="14">x</p>`,
			want: []string{"p:12-14"},
		},
		{name: "non numeric", src: `<p data-source-start="x" data-source-end="y">x</p>`},
		{name: "zero", src: `<p data-source-start="0" data-source-end="0">x</p>`},
		{name: "quote breakout attempt", src: `<p data-source-start='1"onmouseover="alert(1)'>x</p>`},
		{
			name: "element the renderer never marks",
			src:  `<span data-source-start="3">x</span>`,
			want: []string{"p:1-1"},
		},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// act
			out, err := r.RenderInline([]byte(tt.src), "docs/x.md")

			// assert
			require.NoError(t, err)
			assert.Equal(t, tt.want, sourceRanges(t, string(out)))
		})
	}
}

func TestPreprocessLineOrigin(t *testing.T) {
	// act
	doc := preprocess([]byte("---\ntitle: x\n---\nАбзац текста.\n3. Третий\n"))

	// assert
	assert.Equal(t, "Абзац текста.\n\n3. Третий\n", string(doc.src))
	assert.Equal(t, []int{4, 5, 5, 6}, doc.origin)
}

func TestSrcLinesAt(t *testing.T) {
	// arrange
	lines := newSrcLines(preprocess([]byte("---\nx: 1\n---\nодин\n\nдва\n")))

	// act & assert
	assert.Equal(t, []int{4, 4, 5, 6, 6, 7}, []int{
		lines.at(0), lines.at(len("один") - 1), lines.at(len("один\n")),
		lines.at(len("один\n\n")), lines.at(len("один\n\nдва")), lines.at(1 << 20),
	})
}
