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

const PlainLanguage = "Text"

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
