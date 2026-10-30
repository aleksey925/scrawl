package server

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/render"
)

const (
	drawnMark  = `<img alt="drawn">`
	failedMark = `<p class="md-diagram-error">not drawn</p>`
)

type fakeDiagramRenderer struct {
	fragments []string
	deadlines []time.Duration
	err       error
}

type keptDiagrams struct{}

func (keptDiagrams) Inline(_ context.Context, fragment string) (string, error) {
	return fragment, nil
}

func (f *fakeDiagramRenderer) Inline(ctx context.Context, fragment string) (string, error) {
	f.fragments = append(f.fragments, fragment)
	if deadline, ok := ctx.Deadline(); ok {
		f.deadlines = append(f.deadlines, time.Until(deadline))
	}
	if f.err != nil {
		return strings.Replace(fragment, "</pre>", "</pre>"+failedMark, 1), f.err
	}
	start := strings.Index(fragment, render.OpenPlantUML)
	end := strings.Index(fragment, "</pre>")
	return fragment[:start] + drawnMark + fragment[end+len("</pre>"):], nil
}

func TestExportDrawsPlantUML(t *testing.T) {
	// arrange
	diagramRenderer := &fakeDiagramRenderer{}
	ts := newTestServer(t, testOpts{diagramRenderer: diagramRenderer})
	writeNote(t, ts.root, "uml.md", "# UML\n\n```plantuml\nA -> B\n```\n")

	// act
	resp, body := ts.do(t, request{path: "/api/export/uml.md?format=html"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Contains(t, body, drawnMark)
	assert.NotContains(t, body, `<pre class="plantuml"`)
	require.Len(t, diagramRenderer.fragments, 1)
	assert.Contains(t, diagramRenderer.fragments[0], "A -&gt; B")
}

func TestExportGivesTheDiagramsABudget(t *testing.T) {
	// arrange
	diagramRenderer := &fakeDiagramRenderer{}
	ts := newTestServer(t, testOpts{diagramRenderer: diagramRenderer})
	writeNote(t, ts.root, "uml.md", "# UML\n\n```plantuml\nA -> B\n```\n")

	// act
	resp, _ := ts.do(t, request{path: "/api/export/uml.md?format=html"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	require.Len(t, diagramRenderer.deadlines, 1)
	assert.Greater(t, diagramRenderer.deadlines[0], time.Duration(0))
	assert.LessOrEqual(t, diagramRenderer.deadlines[0], ts.diagramBudget())
}

func TestDrawDiagramsCountsTheBudgetFromTheStartOfTheRequest(t *testing.T) {
	// arrange
	diagramRenderer := &fakeDiagramRenderer{}
	m := &mount{
		Web: &Web{Config: Config{WriteTimeout: 10 * time.Second}, DiagramRenderer: diagramRenderer},
		spc: &Space{Name: "notes"},
	}
	spent := 3 * time.Second

	// act
	m.drawDiagrams(context.Background(), time.Now().Add(-spent), render.OpenPlantUML+"A -&gt; B</pre>")

	// assert
	require.Len(t, diagramRenderer.deadlines, 1)
	assert.Greater(t, diagramRenderer.deadlines[0], time.Duration(0))
	assert.LessOrEqual(t, diagramRenderer.deadlines[0], m.diagramBudget()-spent)
}

func TestDiagramBudget(t *testing.T) {
	tests := []struct {
		name  string
		write time.Duration
		want  time.Duration
	}{
		{name: "a share of the write timeout", write: time.Minute, want: 45 * time.Second},
		{name: "a short write timeout", write: 10 * time.Second, want: 7500 * time.Millisecond},
		{name: "no write timeout", write: 0, want: diagramBudgetNoDeadline},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got := (&Web{Config: Config{WriteTimeout: tc.write}}).diagramBudget()

			// assert
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestExportKeepsTheDiagramsAsCodeWhenTheRendererFails(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{diagramRenderer: &fakeDiagramRenderer{err: errors.New("the renderer is gone")}})
	writeNote(t, ts.root, "uml.md", "# UML\n\n```plantuml\nA -> B\n```\n")

	// act
	resp, body := ts.do(t, request{path: "/api/export/uml.md?format=html"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Contains(t, body, `<pre class="plantuml"`)
	assert.Contains(t, body, "</pre>"+failedMark, "the export carries what the renderer gave back with its error")
}

func TestExportOfANoteWithNoPlantUMLDrawsNothing(t *testing.T) {
	// arrange
	diagramRenderer := &fakeDiagramRenderer{}
	ts := newTestServer(t, testOpts{diagramRenderer: diagramRenderer})
	writeNote(t, ts.root, "plain.md", "# Plain\n\n```mermaid\ngraph TD;\n```\n")

	// act
	resp, _ := ts.do(t, request{path: "/api/export/plain.md?format=html"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Empty(t, diagramRenderer.fragments)
}

func TestPlantUMLLibraries(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	tests := []struct {
		name   string
		path   string
		status int
	}{
		{name: "a library", path: "/static/" + ts.Version + "/plantuml/c4.min.js", status: http.StatusOK},
		{name: "the themes", path: "/static/" + ts.Version + "/plantuml/themes.js", status: http.StatusOK},
		{name: "a library that does not exist", path: "/static/" + ts.Version + "/plantuml/nosuch.min.js", status: http.StatusNotFound},
		{name: "a name that climbs out", path: "/static/" + ts.Version + "/plantuml/..%2Fengine.wasm", status: http.StatusNotFound},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, body := ts.do(t, request{path: tc.path, literal: true})

			// assert
			assert.Equal(t, tc.status, resp.status)
			if tc.status == http.StatusOK {
				assert.Contains(t, resp.header.Get("Content-Type"), "javascript")
				assert.Contains(t, resp.header.Get("Cache-Control"), "max-age=31536000")
				assert.Contains(t, body, "PLANTUML_")
			}
		})
	}
}
