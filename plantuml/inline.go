package plantuml

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"html"
	"strings"

	"github.com/aleksey925/scrawl/render"
)

const maxInlined = 32 << 20

const tooLargeTogether = "the note's diagrams are too large to embed together"

func (r *Renderer) Inline(ctx context.Context, fragment string) (string, error) {
	return r.inline(ctx, fragment, maxInlined)
}

func (r *Renderer) inline(ctx context.Context, fragment string, room int) (string, error) {
	var out strings.Builder
	var failures []error
	last := 0
	for _, block := range render.DiagramBlocks(fragment, render.PlantUMLClass) {
		out.WriteString(fragment[last:block.Start])
		drawn, size, err := r.figure(ctx, html.UnescapeString(block.Source), room)
		if err == nil {
			room -= size
		} else {
			drawn, err = keptAsCode(fragment[block.Start:block.End], err)
		}
		if err != nil {
			failures = append(failures, err)
		}
		out.WriteString(drawn)
		last = block.End
	}
	out.WriteString(fragment[last:])
	if len(failures) > 0 {
		return out.String(), fmt.Errorf("a plantuml diagram is left as code: %w", errors.Join(failures...))
	}
	return out.String(), nil
}

func (r *Renderer) figure(ctx context.Context, source string, room int) (string, int, error) {
	svg, err := r.svg(ctx, source)
	if err != nil {
		return "", 0, err
	}
	size := base64.StdEncoding.EncodedLen(len(svg))
	if size > room {
		return "", 0, &diagramError{Message: tooLargeTogether}
	}
	src := "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(svg))
	return `<div class="md-diagram" data-state="done"><div class="md-diagram-view">` +
		`<img alt="PlantUML diagram" src="` + src + `"></div></div>`, size, nil
}

func keptAsCode(block string, err error) (string, error) {
	message := err.Error()
	var failure error
	var diagramErr *diagramError
	if !errors.As(err, &diagramErr) {
		message, failure = "the diagram could not be rendered", err
	}
	note := `<p class="md-diagram-error">` + html.EscapeString(message) + `</p>`
	return `<div class="md-diagram">` + block + note + `</div>`, failure
}
