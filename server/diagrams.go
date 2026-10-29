package server

import (
	"context"
	"net/http"

	log "github.com/go-pkgz/lgr"

	"github.com/aleksey925/scrawl/plantuml"
)

type Diagrams interface {
	Inline(ctx context.Context, fragment string) (string, error)
}

func plantumlLibraryHandler(w http.ResponseWriter, r *http.Request) {
	plantuml.ServeLibrary(w, r, r.PathValue("file"))
}

func (m *mount) drawDiagrams(ctx context.Context, fragment string) string {
	if m.Diagrams == nil {
		return fragment
	}
	drawn, err := m.Diagrams.Inline(ctx, fragment)
	if err != nil {
		log.Printf("[WARN] %s: a plantuml diagram is left as code: %v", m.spc.Name, err)
	}
	return drawn
}
