package server

import (
	"context"
	"crypto/sha1" //nolint:gosec // git names a blob by its sha-1, this is no security check
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"log"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/aleksey925/scrawl/auth"
	"github.com/aleksey925/scrawl/history"
	"github.com/aleksey925/scrawl/htmldiff"
	"github.com/aleksey925/scrawl/render"
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
	// SyncState is all three of those in one load. /api/me uses it and never
	// the getters above: a Sync finishing between two calls would hand the
	// client an error from one attempt beside the paths of another.
	SyncState() history.SyncState
	// Remote reports that the space is a clone, which is the only kind a
	// reset means anything for.
	Remote() bool
	CheckDivergence(ctx context.Context) (history.Divergence, error)
	ResetToRemote(ctx context.Context, op history.ResetOp) (history.ResetResult, error)
	Record(ctx context.Context, op history.Op, mutate func() ([]string, error)) error
	Log(ctx context.Context, p string, limit int) ([]history.Entry, error)
	Version(ctx context.Context, rev, p string) (string, error)
	Change(ctx context.Context, rev, p string) (history.Change, error)
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
	// Restorable says the version holds content other than the file on disk now,
	// so writing it back changes something; a deletion holds none
	Restorable bool `json:"restorable"`
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
	if m.spc.History == nil {
		return (*history.Service)(nil)
	}
	return m.spc.History
}

// isDocument reports whether history may speak about a path at all: markdown is
// the only document the app has, and the store decides what it will serve.
// Neither is a question git can answer - the repository tracks whatever it
// holds, a file the store hides included - so without this the history routes
// are a second way into the notes directory, and one with no policy on it.
func (m *mount) isDocument(p string) bool {
	return isMarkdown(p) && m.spc.Store.Visible(p)
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
		"entries":  historyEntries(entries, m.currentBlob(p, entries)),
	})
}

// historyVersion answers one version: the patch that commit made to the
// document, the same change compared as a reader sees it, and the content as it
// stood afterwards. The path is the historical one the entry carries, which is
// not today's path once a rename sits between them, and content is still read
// by blob for the same reason - but the blobs are resolved from the pair rather
// than taken from the request, because a blob names content and nothing else:
// one that arrived from outside would read any object the repository holds
// under any path the caller likes.
//
// Content is absent whenever there is nothing a reader could be shown: a
// deletion recorded none, and a version too large to edit is too large to
// escape into a JSON string. The patch is always there, and the compared
// blocks are whenever both sides could be rendered.
func (m *mount) historyVersion(w http.ResponseWriter, r *http.Request, p, rev string) {
	change, err := m.history().Change(r.Context(), rev, p)
	if err != nil {
		failHistory(w, r, err)
		return
	}
	diff, err := m.history().Diff(r.Context(), rev, p)
	if err != nil {
		failHistory(w, r, err)
		return
	}
	after, err := m.blobContent(r.Context(), change.After)
	if err != nil {
		failHistory(w, r, err)
		return
	}
	// the version before a rename lived under another path, and history only
	// ever speaks about one the store would serve: a note moved out of a
	// hidden file reads as written from nothing
	var before []byte
	if m.isDocument(change.From) {
		if before, err = m.blobContent(r.Context(), change.Before); err != nil {
			failHistory(w, r, err)
			return
		}
	}

	res := map[string]any{"path": p, "rev": rev, "diff": diff}
	if after != nil && len(after) <= maxEditableFile {
		res["content"] = string(after)
	}
	changes, err := m.compare(change.From, before, p, after)
	if err != nil {
		log.Printf("[WARN] compare %s at %s: %v", p, rev, err)
	} else {
		res["changes"] = changes
	}
	writeJSON(w, http.StatusOK, res)
}

// blobContent reads a blob, and nothing for the empty one a side that did not
// exist resolves to.
func (m *mount) blobContent(ctx context.Context, blob string) ([]byte, error) {
	if blob == "" {
		return nil, nil
	}
	return m.history().Show(ctx, blob)
}

// compare renders both sides through the page cache and lines them up block by
// block. Lining up is quadratic in the worst case, so it runs under the render
// deadline too; a side that did not exist is an empty document.
func (m *mount) compare(oldPath string, old []byte, curPath string, cur []byte) ([]htmldiff.Row, error) {
	oldDoc, err := m.diffSide(oldPath, old)
	if err != nil {
		return nil, err
	}
	curDoc, err := m.diffSide(curPath, cur)
	if err != nil {
		return nil, err
	}
	return withDeadline(curPath, renderTimeout, func() ([]htmldiff.Row, error) {
		return htmldiff.Diff(oldDoc, curDoc)
	})
}

func (m *mount) diffSide(p string, data []byte) (htmldiff.Document, error) {
	if data == nil {
		return htmldiff.Document{}, nil
	}
	res, err := m.renderDoc(p, data, store.Rev(data))
	if err != nil {
		return htmldiff.Document{}, err
	}
	return htmldiff.Document{Frontmatter: render.Frontmatter(data), HTML: string(res.HTML)}, nil
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
	r = m.keepThrough(r, p)
	data = []byte(m.formatOnSave(r, p, string(data)).text)

	var fi store.FileInfo
	err = m.record(r, history.Op{Message: "restore " + p, Paths: []string{p}}, func() ([]string, error) {
		var writeErr error
		fi, writeErr = m.spc.Store.Write(p, data, req.Rev)
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

func historyEntries(entries []history.Entry, current string) []historyEntry {
	res := make([]historyEntry, 0, len(entries))
	for _, ent := range entries {
		res = append(res, historyEntry{
			Rev:        ent.Rev,
			Short:      ent.Short,
			Blob:       ent.Blob,
			Actor:      ent.Actor,
			Message:    ent.Message,
			Path:       ent.Path,
			Kind:       string(ent.Kind),
			At:         ent.At,
			Restorable: ent.Blob != "" && ent.Blob != current,
		})
	}
	return res
}

// currentBlob answers the id git would give the file on disk now, in the hash
// the ids of the entries are in: a repository has one. A file that is not
// there, or a log with no content in it, answers an empty id, which no version
// with content has.
func (m *mount) currentBlob(p string, entries []history.Entry) string {
	idx := slices.IndexFunc(entries, func(ent history.Entry) bool { return ent.Blob != "" })
	if idx < 0 {
		return ""
	}
	data, _, err := m.spc.Store.Read(p)
	if err != nil {
		return ""
	}
	return blobID(data, len(entries[idx].Blob))
}

// blobID is the id git gives content as a blob: sha-1 in an ordinary
// repository and sha-256 in one made with --object-format=sha256.
func blobID(data []byte, idLen int) string {
	var h hash.Hash
	if idLen == sha256.Size*2 {
		h = sha256.New()
	} else {
		h = sha1.New() //nolint:gosec // git names a blob by its sha-1, this is no security check
	}
	h.Write([]byte("blob " + strconv.Itoa(len(data)) + "\x00"))
	h.Write(data)
	return hex.EncodeToString(h.Sum(nil))
}
