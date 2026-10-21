package render

import (
	"bytes"
	"fmt"
	"html"
	"html/template"
	"strings"

	"github.com/alecthomas/chroma/v2"
	"github.com/alecthomas/chroma/v2/lexers"
)

// PlainLanguage names a text file chroma has no lexer for.
const PlainLanguage = "Text"

// HighlightFile colors a text file the way a fence in a note is colored, and
// names its language. The file comes out as one pre with one element per line
// and no line numbers in the text: the page draws them, so a copy and a
// selection hold exactly the source.
func (r *Renderer) HighlightFile(name string, data []byte) (template.HTML, string, error) {
	lexer := lexers.Match(name)
	if lexer == nil {
		return PlainFile(data), PlainLanguage, nil
	}
	lexer = chroma.Coalesce(lexer)
	tokens, err := lexer.Tokenise(nil, string(data))
	if err != nil {
		return "", "", fmt.Errorf("highlight %s: %w", name, err)
	}
	var buf bytes.Buffer
	if err = markupFormatter.Format(&buf, markupStyle, tokens); err != nil {
		return "", "", fmt.Errorf("highlight %s: %w", name, err)
	}
	clean := r.policy.SanitizeBytes(buf.Bytes())
	return template.HTML(clean), lexer.Config().Name, nil //nolint:gosec // sanitized by bluemonday above
}

// PlainFile is a text file escaped into the markup HighlightFile writes, one
// element per line, with no colors: for a file too large to highlight, or one
// whose highlighting ran out of time.
func PlainFile(data []byte) template.HTML {
	var out strings.Builder
	out.WriteString(`<pre class="chroma"><code>`)
	for line := range strings.SplitAfterSeq(string(data), "\n") {
		if line == "" && len(data) > 0 {
			break
		}
		out.WriteString(`<span class="line"><span class="cl">`)
		out.WriteString(html.EscapeString(line))
		out.WriteString("</span></span>")
	}
	out.WriteString("</code></pre>")
	return template.HTML(out.String()) //nolint:gosec // every byte of the file is escaped
}
