package plantuml

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"golang.org/x/net/html"
)

const DiagramTimeout = 20 * time.Second

const diagramClass = "plantuml"

func (r *Renderer) Inline(ctx context.Context, fragment string) (string, error) {
	var out strings.Builder
	var failures []error
	z := html.NewTokenizer(strings.NewReader(fragment))
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			return out.String(), errors.Join(failures...)
		}
		open := string(z.Raw())
		if tt != html.StartTagToken || !isDiagram(z) {
			out.WriteString(open)
			continue
		}
		var block, source strings.Builder
		closed := false
		for !closed {
			tt = z.Next()
			if tt == html.ErrorToken {
				out.WriteString(open + block.String())
				return out.String(), errors.Join(failures...)
			}
			raw := string(z.Raw())
			switch tt {
			case html.EndTagToken:
				name, _ := z.TagName()
				closed = string(name) == "pre"
			case html.TextToken:
				source.Write(z.Text())
			}
			if !closed {
				block.WriteString(raw)
			}
		}
		drawn, err := r.figure(ctx, open+block.String()+"</pre>", source.String())
		if err != nil {
			failures = append(failures, err)
		}
		out.WriteString(drawn)
	}
}

func isDiagram(z *html.Tokenizer) bool {
	name, hasAttr := z.TagName()
	if string(name) != "pre" {
		return false
	}
	for hasAttr {
		var key, val []byte
		key, val, hasAttr = z.TagAttr()
		if string(key) == "class" && slices.Contains(strings.Fields(string(val)), diagramClass) {
			return true
		}
	}
	return false
}

func (r *Renderer) figure(ctx context.Context, block, source string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, DiagramTimeout)
	defer cancel()
	svg, err := r.SVG(ctx, source)
	if err != nil {
		message, failure := err.Error(), error(nil)
		var diagramErr *DiagramError
		if !errors.As(err, &diagramErr) {
			message, failure = "the diagram could not be rendered", fmt.Errorf("plantuml: %w", err)
		}
		note := `<p class="md-diagram-error">` + html.EscapeString(message) + `</p>`
		return `<div class="md-diagram">` + block + note + `</div>`, failure
	}
	src := "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(svg))
	return `<div class="md-diagram" data-state="done"><div class="md-diagram-view">` +
		`<img alt="PlantUML diagram" src="` + src + `"></div></div>`, nil
}
