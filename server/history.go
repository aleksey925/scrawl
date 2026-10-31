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

const historyLimit = 200

type History interface {
	Enabled() bool
	Degraded() bool
	Unpublished() bool
	SyncError() string
	SyncState() history.SyncState
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

var errHistoryNotRecorded = errors.New("not recorded in history")

type historyEntry struct {
	Rev        string    `json:"rev"`
	Short      string    `json:"short"`
	Blob       string    `json:"blob"`
	Actor      string    `json:"actor"`
	Message    string    `json:"message"`
	Path       string    `json:"path"`
	Kind       string    `json:"kind"`
	At         time.Time `json:"at"`
	Restorable bool      `json:"restorable"`
}

type restoreRequest struct {
	Rev     string `json:"rev"`
	Version string `json:"version"`
	From    string `json:"from"`
}

func (m *mount) history() History {
	if m.spc.History == nil {
		return (*history.Service)(nil)
	}
	return m.spc.History
}

func (m *mount) isDocument(p string) bool {
	return isMarkdown(p) && m.spc.Store.Visible(p)
}

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

func (m *mount) blobContent(ctx context.Context, blob string) ([]byte, error) {
	if blob == "" {
		return nil, nil
	}
	return m.history().Show(ctx, blob)
}

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
		return fmt.Errorf("%w: %w", store.ErrForbidden, err)
	case errors.Is(err, history.ErrNotPublished):
		return err
	}
	return fmt.Errorf("%w: %w", errHistoryNotRecorded, err)
}

func (wb *Web) actor(r *http.Request) string {
	if wb.Auth == nil {
		return ""
	}
	return wb.Auth.Actor(r)
}

func (m *mount) withHistory(res map[string]any) map[string]any {
	res["history_degraded"] = m.history().Degraded()
	res["unpublished"] = m.history().Unpublished()
	return res
}

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
