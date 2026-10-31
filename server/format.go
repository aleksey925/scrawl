package server

import (
	"context"
	"net/http"
	"time"

	log "github.com/go-pkgz/lgr"
)

const formatTimeout = 30 * time.Second

type Formatter interface {
	Markdown(ctx context.Context, text string) (string, error)
}

func (m *mount) formats(p string) bool { return m.spc.FormatOnSave && isMarkdown(p) }

func (m *mount) keepThrough(r *http.Request, p string) *http.Request {
	if !m.formats(p) {
		return r
	}
	return r.WithContext(context.WithoutCancel(r.Context()))
}

type saved struct {
	text   string
	failed bool
}

func (m *mount) formatOnSave(r *http.Request, p, text string) saved {
	if !m.formats(p) {
		return saved{text: text}
	}
	ctx, cancel := context.WithTimeout(r.Context(), formatTimeout)
	defer cancel()

	formatted, err := m.Formatter.Markdown(ctx, text)
	if err != nil {
		log.Printf("[WARN] %s: %s is stored as written, not formatted: %v", m.spc.Name, p, err)
		return saved{text: text, failed: true}
	}
	return saved{text: formatted}
}

func (s saved) describe(res map[string]any, sent string) map[string]any {
	if s.failed {
		res["format_failed"] = true
	}
	if s.text != sent {
		res["content"] = s.text
	}
	return res
}
