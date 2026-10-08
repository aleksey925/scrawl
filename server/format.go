package server

import (
	"context"
	"errors"
	"net/http"
	"time"

	log "github.com/go-pkgz/lgr"

	"github.com/aleksey925/scrawl/format"
)

// formatTimeout is how long a request gives prettier, the wait for a free
// worker included. It is above what a note at the size cap takes, and what it
// cuts short is text prettier is quadratic on: 8KB of "[" runs for half a minute.
const formatTimeout = 30 * time.Second

// Formatter is the part of format.Formatter the web layer uses, so the
// handlers can be driven without running prettier.
type Formatter interface {
	Markdown(ctx context.Context, text string) (string, error)
	MarkdownAt(ctx context.Context, text string, cursor int) (format.Result, error)
}

type formatRequest struct {
	Content string `json:"content"`
	Cursor  int    `json:"cursor"`
}

// apiFormat formats an editor buffer and writes nothing. It sits behind the
// write guard all the same: it is the most expensive request the server
// answers, and a reader who cannot save has no use for it.
func (m *mount) apiFormat(w http.ResponseWriter, r *http.Request) {
	if m.refuseReadOnly(w, r) {
		return
	}
	var req formatRequest
	if !decodeJSON(w, r, &req, maxJSONBody) {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), formatTimeout)
	defer cancel()
	res, err := m.Formatter.MarkdownAt(ctx, req.Content, req.Cursor)
	switch {
	case errors.Is(err, format.ErrTooLarge):
		jsonError(w, http.StatusRequestEntityTooLarge, "the note is too large to format")
		return
	case errors.Is(err, context.DeadlineExceeded):
		logFailure(r, http.StatusServiceUnavailable, err)
		jsonError(w, http.StatusServiceUnavailable, "formatting took too long")
		return
	case err != nil:
		logFailure(r, http.StatusInternalServerError, err)
		jsonError(w, http.StatusInternalServerError, "could not format the note")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"content": res.Text, "cursor": res.Cursor})
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
	text   string
	cursor *int // the editor's, moved with the text; nil for a caller with none
	// failed is a note prettier gave up on, which is stored as it was written
	failed bool
}

// formatOnSave answers what a write of p stores: the text as prettier leaves
// it when the space asks for that, and the text as it came otherwise.
func (m *mount) formatOnSave(r *http.Request, p, text string, cursor *int) saved {
	if !m.formats(p) {
		return saved{text: text, cursor: cursor}
	}
	ctx, cancel := context.WithTimeout(r.Context(), formatTimeout)
	defer cancel()

	var res format.Result
	var err error
	if cursor == nil {
		res.Text, err = m.Formatter.Markdown(ctx, text)
	} else {
		res, err = m.Formatter.MarkdownAt(ctx, text, *cursor)
	}
	if err != nil {
		// not a failed save: a note prettier gave up on is still a note
		// somebody wants stored, and the next save tries again
		log.Printf("[WARN] %s: %s is stored as written, not formatted: %v", m.spc.Name, p, err)
		return saved{text: text, cursor: cursor, failed: true}
	}
	if cursor == nil {
		return saved{text: res.Text}
	}
	return saved{text: res.Text, cursor: &res.Cursor}
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
		if s.cursor != nil {
			res["cursor"] = *s.cursor
		}
	}
	return res
}
