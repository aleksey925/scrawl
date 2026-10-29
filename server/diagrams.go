package server

import (
	"context"
	"net/http"
	"time"

	log "github.com/go-pkgz/lgr"

	"github.com/aleksey925/scrawl/plantuml"
)

const (
	diagramBudgetPercent    = 75
	diagramBudgetNoDeadline = 45 * time.Second
)

type DiagramRenderer interface {
	Inline(ctx context.Context, fragment string) (string, error)
}

func plantumlLibraryHandler(w http.ResponseWriter, r *http.Request) {
	plantuml.ServeLibrary(w, r, r.PathValue("file"))
}

func (wb *Web) diagramBudget() time.Duration {
	if wb.WriteTimeout <= 0 {
		return diagramBudgetNoDeadline
	}
	return wb.WriteTimeout * diagramBudgetPercent / 100
}

func (m *mount) drawDiagrams(ctx context.Context, started time.Time, fragment string) string {
	ctx, cancel := context.WithDeadline(ctx, started.Add(m.diagramBudget()))
	defer cancel()
	drawn, err := m.DiagramRenderer.Inline(ctx, fragment)
	if err != nil {
		log.Printf("[WARN] %s: %v", m.spc.Name, err)
	}
	return drawn
}
