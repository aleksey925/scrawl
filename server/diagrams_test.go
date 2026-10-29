package server

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const drawnMark = `<img alt="drawn">`

type fakeDiagrams struct {
	fragments []string
}

func (f *fakeDiagrams) Inline(_ context.Context, fragment string) (string, error) {
	f.fragments = append(f.fragments, fragment)
	start := strings.Index(fragment, `<pre class="plantuml"`)
	end := strings.Index(fragment, "</pre>")
	return fragment[:start] + drawnMark + fragment[end+len("</pre>"):], nil
}

func TestExportDrawsPlantUML(t *testing.T) {
	// arrange
	diagrams := &fakeDiagrams{}
	ts := newTestServer(t, testOpts{diagrams: diagrams})
	writeNote(t, ts.root, "uml.md", "# UML\n\n```plantuml\nA -> B\n```\n")

	// act
	resp, body := ts.do(t, request{path: "/api/export/uml.md?format=html"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Contains(t, body, drawnMark)
	assert.NotContains(t, body, `<pre class="plantuml"`)
	require.Len(t, diagrams.fragments, 1)
	assert.Contains(t, diagrams.fragments[0], "A -&gt; B")
}

func TestExportOfANoteWithNoPlantUMLDrawsNothing(t *testing.T) {
	// arrange
	diagrams := &fakeDiagrams{}
	ts := newTestServer(t, testOpts{diagrams: diagrams})
	writeNote(t, ts.root, "plain.md", "# Plain\n\n```mermaid\ngraph TD;\n```\n")

	// act
	resp, _ := ts.do(t, request{path: "/api/export/plain.md?format=html"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Empty(t, diagrams.fragments)
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
