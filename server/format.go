package server

import (
	"context"
	"net/http"
	"time"

	log "github.com/go-pkgz/lgr"
)

// formatTimeout is how long a request gives prettier, the wait for a free
// worker included. It is above what a note at the size cap takes, and what it
// cuts short is text prettier is quadratic on: 8KB of "[" runs for half a minute.
const formatTimeout = 30 * time.Second

// Formatter is the part of format.Formatter the web layer uses, so the
// handlers can be driven without running prettier.
type Formatter interface {
	Markdown(ctx context.Context, text string) (string, error)
}

// formats reports whether a write of p goes through prettier.
func (m *mount) formats(p string) bool { return m.spc.FormatOnSave && isMarkdown(p) }

// keepThrough detaches a write that formats from its client. Formatting takes
// seconds, and a tab closed meanwhile would cancel what comes after it: the
// note stored unformatted by the fallback, or the commit killed half way.
func (m *mount) keepThrough(r *http.Request, p string) *http.Request {
	if !m.formats(p) {
		return r
	}
	return r.WithContext(context.WithoutCancel(r.Context()))
}

// saved is what a write stores once formatOnSave has seen it.
type saved struct {
	text string
	// failed is a note prettier gave up on, which is stored as it was written
	failed bool
}

// formatOnSave answers what a write of p stores: the text as prettier leaves
// it when the space asks for that, and the text as it came otherwise.
func (m *mount) formatOnSave(r *http.Request, p, text string) saved {
	if !m.formats(p) {
		return saved{text: text}
	}
	ctx, cancel := context.WithTimeout(r.Context(), formatTimeout)
	defer cancel()

	formatted, err := m.Formatter.Markdown(ctx, text)
	if err != nil {
		// not a failed save: a note prettier gave up on is still a note
		// somebody wants stored, and the next save tries again
		log.Printf("[WARN] %s: %s is stored as written, not formatted: %v", m.spc.Name, p, err)
		return saved{text: text, failed: true}
	}
	return saved{text: formatted}
}

// describe adds to the answer of a write what formatting did to the note: the
// text when it is no longer the one that was sent, and the failure when
// prettier gave up, so nobody takes an unformatted note for a formatted one.
func (s saved) describe(res map[string]any, sent string) map[string]any {
	if s.failed {
		res["format_failed"] = true
	}
	if s.text != sent {
		res["content"] = s.text
	}
	return res
}
