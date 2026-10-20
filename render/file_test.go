package render

import (
	"html/template"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/net/html"
)

// textOf is what a copy of the rendered file takes: the text of its markup
func textOf(t *testing.T, markup template.HTML) string {
	t.Helper()
	doc, err := html.Parse(strings.NewReader(string(markup)))
	require.NoError(t, err)
	var out strings.Builder
	var walk func(n *html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.TextNode {
			out.WriteString(n.Data)
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(doc)
	return out.String()
}

func TestHighlightFile(t *testing.T) {
	tests := []struct {
		name         string
		file         string
		src          string
		wantLanguage string
		wantColored  bool
	}{
		{
			name:         "go",
			file:         "main.go",
			src:          "package main\n\nfunc main() {\n\tprintln(\"hi\")\n}\n",
			wantLanguage: "Go",
			wantColored:  true,
		},
		{name: "unknown extension", file: "notes.zzz", src: "plain\ntext\n", wantLanguage: PlainLanguage},
		{
			name:         "a script in html is text",
			file:         "x.html",
			src:          "<p>hi</p>\n<script>alert(1)</script>\n",
			wantLanguage: "HTML",
			wantColored:  true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			r := New(Options{})

			// act
			markup, language, err := r.HighlightFile(tc.file, []byte(tc.src))

			// assert
			require.NoError(t, err)
			assert.Equal(t, tc.wantLanguage, language)
			assert.Equal(t, strings.Count(tc.src, "\n"), strings.Count(string(markup), `<span class="line">`))
			assert.Equal(t, tc.wantColored, strings.Contains(string(markup), `<span class="k`) ||
				strings.Contains(string(markup), `<span class="nt`))
			assert.NotContains(t, string(markup), "<table")
			assert.NotContains(t, string(markup), "<script")
			assert.Equal(t, tc.src, textOf(t, markup))
		})
	}
}

func TestPlainFile(t *testing.T) {
	// arrange
	src := "a < b\n\n<b>bold</b>\n"

	// act
	markup := PlainFile([]byte(src))

	// assert
	assert.Equal(t, 3, strings.Count(string(markup), `<span class="line">`))
	assert.NotContains(t, string(markup), "<b>")
	assert.Equal(t, src, textOf(t, markup))
}
