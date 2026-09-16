package server

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/aleksey925/scrawl/auth"
	"github.com/aleksey925/scrawl/history"
	"github.com/aleksey925/scrawl/store"
)

// historyLimit caps how many versions of one document the list endpoint
// returns. The page lists them all at once, and nobody scrolls further back.
const historyLimit = 200

// History is the part of history.Service the web layer uses, so the handlers
// can be driven without a git repository behind them.
type History interface {
	Enabled() bool
	Degraded() bool
	// Unpublished reports that the clone holds commits the remote does not. It
	// is a second state beside Degraded, not a reuse of it: a commit that
	// stages nothing succeeds and clears Degraded, which would report a healthy
	// history while the remote was still behind.
	Unpublished() bool
	// SyncError is what the last conversation with the remote failed with,
	// already redacted: it is rendered in the UI, which lgr.Secret never sees.
	SyncError() string
	Record(ctx context.Context, op history.Op, mutate func() ([]string, error)) error
	Log(ctx context.Context, p string, limit int) ([]history.Entry, error)
	Version(ctx context.Context, rev, p string) (string, error)
	Show(ctx context.Context, blob string) ([]byte, error)
	Diff(ctx context.Context, rev, p string) (string, error)
}

// errHistoryNotRecorded marks a write that reached the disk and never reached
// history. Only a strict caller, which is an API client, is told about it.
var errHistoryNotRecorded = errors.New("not recorded in history")

// historyEntry is one version of a document as the JSON API spells it.
type historyEntry struct {
	Rev     string    `json:"rev"`
	Short   string    `json:"short"`
	Blob    string    `json:"blob"`
	Actor   string    `json:"actor"`
	Message string    `json:"message"`
	Path    string    `json:"path"`
	Kind    string    `json:"kind"`
	At      time.Time `json:"at"`
}

// restoreRequest names the version to write back. Version is the commit that
// recorded it and From the path the document had at that commit, which is not
// today's path once a rename sits between them; an empty From is that path.
// Rev is the revision on disk the page was built from.
type restoreRequest struct {
	Rev     string `json:"rev"`
	Version string `json:"version"`
	From    string `json:"from"`
}

// history returns the service, falling back to the disabled one. A nil
// *history.Service answers every method, so a server running without history
// needs no second code path anywhere in the handlers.
func (m *mount) history() History {
	if m.prj.History == nil {
		return (*history.Service)(nil)
	}
	return m.prj.History
}

// isDocument reports whether history may speak about a path at all: markdown is
// the only document the app has, and the store decides what it will serve.
// Neither is a question git can answer - the repository tracks whatever it
// holds, a file the store hides included - so without this the history routes
// are a second way into the notes directory, and one with no policy on it.
func (m *mount) isDocument(p string) bool {
	return isMarkdown(p) && m.prj.Store.Visible(p)
}

// historyPath pulls the document out of a history URL and answers the request
// itself when the path is not one history may speak about.
func (m *mount) historyPath(w http.ResponseWriter, r *http.Request) (string, bool) {
	p, ok := contentPath(r, "path")
	if !ok || p == "" {
		jsonError(w, http.StatusBadRequest, "bad path")
		return "", false
	}
	if !m.isDocument(p) {
		failJSON(w, r, fmt.Errorf("history %q: %w", p, store.ErrNotFound))
		return "", false
	}
	return p, true
}

// apiHistory lists the versions of a document, newest first, and serves one of
// them instead when the query names a revision.
func (m *mount) apiHistory(w http.ResponseWriter, r *http.Request) {
	p, ok := m.historyPath(w, r)
	if !ok {
		return
	}
	if rev := r.URL.Query().Get("rev"); rev != "" {
		m.historyVersion(w, r, p, rev)
		return
	}

	entries, err := m.history().Log(r.Context(), p, historyLimit)
	if err != nil {
		failHistory(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":     p,
		"degraded": m.history().Degraded(),
		"entries":  historyEntries(entries),
	})
}

// historyVersion answers one version: the patch that commit made to the
// document, plus the content as it stood afterwards. The path is the historical
// one the entry carries, which is not today's path once a rename sits between
// them, and content is still read by blob for the same reason - but the blob is
// resolved from the pair rather than taken from the request, because a blob
// names content and nothing else: one that arrived from outside would read any
// object the repository holds under any path the caller likes.
//
// Content is absent whenever there is nothing a reader could be shown: a
// deletion recorded none, and a version too large to edit is too large to
// escape into a JSON string. The diff is always there.
func (m *mount) historyVersion(w http.ResponseWriter, r *http.Request, p, rev string) {
	blob, err := m.history().Version(r.Context(), rev, p)
	if err != nil {
		failHistory(w, r, err)
		return
	}
	diff, err := m.history().Diff(r.Context(), rev, p)
	if err != nil {
		failHistory(w, r, err)
		return
	}

	res := map[string]any{"path": p, "rev": rev, "diff": diff}
	if blob != "" {
		data, showErr := m.history().Show(r.Context(), blob)
		if showErr != nil {
			failHistory(w, r, showErr)
			return
		}
		if len(data) <= maxEditableFile {
			res["content"] = string(data)
		}
	}
	writeJSON(w, http.StatusOK, res)
}

// versionContent reads the version a request named. A pair that resolves to no
// blob is a commit that deleted the document, which left no content to write
// back, and is refused like a pair that names no version at all.
func (m *mount) versionContent(ctx context.Context, rev, p string) ([]byte, error) {
	blob, err := m.history().Version(ctx, rev, p)
	if err != nil {
		return nil, err
	}
	if blob == "" {
		return nil, fmt.Errorf("history: version %s %q: %w", rev, p, history.ErrNoVersion)
	}
	return m.history().Show(ctx, blob)
}

// apiHistoryRestore writes an old version back through the store, as an
// ordinary save that history records like any other: nothing is rewritten, and
// undoing the undo works. The client sends the revision it last saw, so a
// history page left open cannot silently overwrite a newer edit - that comes
// back as the same conflict the editor already knows.
//
// The version is named by the commit that recorded it and the path the document
// had back then, and both are checked before anything is written: a restore
// that took content the caller pointed at would copy any object the repository
// holds into any document. The content has to fit what an ordinary save takes,
// because this is one.
func (m *mount) apiHistoryRestore(w http.ResponseWriter, r *http.Request) {
	if m.refuseReadOnly(w, r) {
		return
	}
	p, ok := m.historyPath(w, r)
	if !ok {
		return
	}
	var req restoreRequest
	if !decodeJSON(w, r, &req, maxJSONBody) {
		return
	}
	from := req.From
	if from == "" {
		from = p
	}
	if !m.isDocument(from) {
		failJSON(w, r, fmt.Errorf("history %q: %w", from, store.ErrNotFound))
		return
	}

	data, err := m.versionContent(r.Context(), req.Version, from)
	if err != nil {
		failHistory(w, r, err)
		return
	}
	if len(data) > maxEditableFile {
		jsonError(w, http.StatusRequestEntityTooLarge, errMessage(store.ErrTooLarge))
		return
	}

	var fi store.FileInfo
	err = m.record(r, history.Op{Message: "restore " + p, Paths: []string{p}}, func() ([]string, error) {
		var writeErr error
		fi, writeErr = m.prj.Store.Write(p, data, req.Rev)
		return nil, writeErr
	})
	var conflict *store.ConflictError
	switch {
	case errors.As(err, &conflict):
		writeConflict(w, http.StatusPreconditionFailed, "conflict", conflict.CurrentRev, conflict.Current)
		return
	case err != nil:
		failJSON(w, r, err)
		return
	}

	m.touch(p)
	writeJSON(w, http.StatusOK, m.withHistory(map[string]any{
		"path": p, "rev": store.Rev(data), "mod_time": fi.ModTime,
	}))
}

// record runs a store mutation inside history, under the actor behind the
// request. A write from an API client is strict: an agent must never be told a
// document changed when history holds no record of it. A write from a browser
// is not, because a repository that cannot commit has to cost the reader a
// warning and never the save itself.
func (m *mount) record(r *http.Request, op history.Op, mutate func() ([]string, error)) error {
	op.Actor = m.actor(r)
	op.Strict = auth.ByToken(r)

	var mutated error
	err := m.history().Record(r.Context(), op, func() ([]string, error) {
		paths, mErr := mutate()
		mutated = mErr
		return paths, mErr
	})
	switch {
	case err == nil, mutated != nil:
		return err
	case errors.Is(err, history.ErrBadPath):
		// refused before the mutation ran, so nothing was written and the
		// client gets what the store answers for a path it would not touch
		return fmt.Errorf("%w: %w", store.ErrForbidden, err)
	case errors.Is(err, history.ErrNotPublished):
		// before the wrap below, because errHistoryNotRecorded is matched first
		// by both statusOf and errMessage: the change was recorded, and only
		// not pushed, and telling an agent otherwise would be wrong
		return err
	}
	return fmt.Errorf("%w: %w", errHistoryNotRecorded, err)
}

// actor names who is behind a request. An empty name is what history reads as
// unknown, which is all a server assembled without auth can honestly say.
func (wb *Web) actor(r *http.Request) string {
	if wb.Auth == nil {
		return ""
	}
	return wb.Auth.Actor(r)
}

// withHistory adds what the UI needs to tell that a change did not land where
// it was supposed to. Every mutating endpoint carries it, because the warning
// belongs on the change that was missed rather than on whatever page is loaded
// next - and a deletion that never left the container is the worst one to lose.
func (m *mount) withHistory(res map[string]any) map[string]any {
	res["history_degraded"] = m.history().Degraded()
	res["unpublished"] = m.history().Unpublished()
	return res
}

// failHistory answers a failed history read. The status is everything a client
// can act on, and the cause goes to the log: a repository that stopped working
// is a deployment problem nobody can diagnose from a response body.
func failHistory(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, history.ErrDisabled):
		jsonError(w, http.StatusServiceUnavailable, "history is disabled")
	case errors.Is(err, history.ErrBadPath):
		jsonError(w, http.StatusBadRequest, "bad path")
	case errors.Is(err, history.ErrNoVersion):
		jsonError(w, http.StatusNotFound, "no such version")
	default:
		log.Printf("[ERROR] %s %s: %v", r.Method, r.URL.Path, err)
		jsonError(w, http.StatusInternalServerError, "history is unavailable")
	}
}

func historyEntries(entries []history.Entry) []historyEntry {
	res := make([]historyEntry, 0, len(entries))
	for _, ent := range entries {
		res = append(res, historyEntry{
			Rev:     ent.Rev,
			Short:   ent.Short,
			Blob:    ent.Blob,
			Actor:   ent.Actor,
			Message: ent.Message,
			Path:    ent.Path,
			Kind:    string(ent.Kind),
			At:      ent.At,
		})
	}
	return res
}
