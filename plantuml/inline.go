package plantuml

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"html"
	"regexp"
	"strings"
)

var diagramBlock = regexp.MustCompile(`(?s)<pre class="plantuml"[^>]*>(.*?)</pre>`)

func (r *Renderer) Inline(ctx context.Context, fragment string) (string, error) {
	var out strings.Builder
	var failures []error
	last := 0
	for _, loc := range diagramBlock.FindAllStringSubmatchIndex(fragment, -1) {
		out.WriteString(fragment[last:loc[0]])
		drawn, err := r.figure(ctx, fragment[loc[0]:loc[1]], html.UnescapeString(fragment[loc[2]:loc[3]]))
		if err != nil {
			failures = append(failures, err)
		}
		out.WriteString(drawn)
		last = loc[1]
	}
	out.WriteString(fragment[last:])
	return out.String(), errors.Join(failures...)
}

func (r *Renderer) figure(ctx context.Context, block, source string) (string, error) {
	svg, err := r.svg(ctx, source)
	if err != nil {
		message, failure := err.Error(), error(nil)
		var diagramErr *diagramError
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
