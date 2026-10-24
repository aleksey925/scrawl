package server

import (
	"bytes"
	"errors"
	"html/template"
	"log"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/aleksey925/scrawl/auth"
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/store"
	"github.com/aleksey925/scrawl/view"
)

const pageCacheControl = "private, no-cache"

type handoff struct {
	Error string `json:"error"`
	Kind  string `json:"kind"`
	URL   string `json:"url"`
}

type navResponse struct {
	Tree        []view.NavNode `json:"tree"`
	Breadcrumbs []view.Crumb   `json:"breadcrumbs"`
}

type meResponse struct {
	User            string     `json:"user"`
	AuthOn          bool       `json:"auth_on"`
	ReadOnly        bool       `json:"read_only"`
	HistoryOn       bool       `json:"history_on"`
	HistoryDegraded bool       `json:"history_degraded"`
	SiteTitle       string     `json:"site_title"`
	Version         string     `json:"version"`
	Space           spaceState `json:"space"`
}

type spaceState struct {
	Name         string        `json:"name"`
	Label        string        `json:"label"`
	Kind         string        `json:"kind"`
	ReadOnly     bool          `json:"read_only"`
	FormatOnSave bool          `json:"format_on_save"`
	Degraded     bool          `json:"degraded"`
	Unpublished  bool          `json:"unpublished"`
	SyncError    string        `json:"sync_error"`
	Unsynced     unsyncedPaths `json:"unsynced"`
	Diverged     bool          `json:"diverged"`
	PushRefused  bool          `json:"push_refused"`
	CanReset     bool          `json:"can_reset"`
}

type unsyncedPaths struct {
	Paths []string `json:"paths"`
	Many  bool     `json:"many"`
}

type spaceEntry struct {
	Name     string `json:"name"`
	Label    string `json:"label"`
	URL      string `json:"url"`
	Kind     string `json:"kind"`
	ReadOnly bool   `json:"read_only"`
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginResponse struct {
	User string `json:"user"`
}

func (m *mount) apiPage(w http.ResponseWriter, r *http.Request) {
	p, ok := contentPath(r, "path")
	if !ok {
		jsonError(w, http.StatusBadRequest, "bad path")
		return
	}

	stat, err := m.spc.Store.Stat(p)
	switch {
	case errors.Is(err, store.ErrNotFound) && isMarkdown(p):
		writeJSON(w, http.StatusNotFound, view.MissingPage(p, m.canWrite(r)))
		return
	case err != nil:
		failJSON(w, r, err)
		return
	case stat.IsDir:
		writeHandoff(w, view.KindDirectory, view.DirURL(p), "path is a directory, list it from /api/dir/")
		return
	case !isMarkdown(p):
		m.writeFile(w, r, stat)
		return
	}

	m.writeDoc(w, r, p)
}

func (m *mount) apiDir(w http.ResponseWriter, r *http.Request) {
	p, ok := contentPath(r, "path")
	if !ok {
		jsonError(w, http.StatusBadRequest, "bad path")
		return
	}

	stat, err := m.spc.Store.Stat(p)
	if err != nil {
		failJSON(w, r, err)
		return
	}
	if !stat.IsDir {
		writeHandoff(w, view.KindDocument, view.ContentURL(p), "path is not a directory")
		return
	}

	entries, err := m.spc.Store.List(p)
	if err != nil {
		failJSON(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view.NewDir(p, entries, m.spc.Store.Count, editable))
}

func (m *mount) writeDoc(w http.ResponseWriter, r *http.Request, p string) {
	data, fi, err := m.spc.Store.Read(p)
	if err != nil {
		failJSON(w, r, err)
		return
	}

	rev := store.Rev(data)
	etag := strconv.Quote(rev)
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", pageCacheControl)
	if matchesETag(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	res, err := m.renderDoc(p, data, rev)
	if err != nil {
		failJSON(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, view.NewPage(p, res, rev, fi.ModTime, m.canWrite(r)))
}

func (m *mount) writeFile(w http.ResponseWriter, r *http.Request, fi store.FileInfo) {
	contentType, _ := rawContentType(fi.Name)
	switch {
	case strings.HasPrefix(contentType, "image/"):
		writeJSON(w, http.StatusOK, view.NewFile(fi, view.FileImage))
		return
	case !editable(fi):
		writeJSON(w, http.StatusOK, view.NewFile(fi, view.FileOther))
		return
	}

	data, read, err := m.spc.Store.Read(fi.Path)
	if err != nil {
		failJSON(w, r, err)
		return
	}
	if !textContent(data) {
		writeJSON(w, http.StatusOK, view.NewFile(read, view.FileOther))
		return
	}
	res := view.NewFile(read, view.FileText)
	res.Rev = store.Rev(data)
	res.EditURL = view.EditURL(read.Path)
	res.Lines = lineCount(data)
	res.HTML, res.Language = m.highlight(read.Path, data)
	writeJSON(w, http.StatusOK, res)
}

func (m *mount) highlight(p string, data []byte) (string, string) {
	return highlightFile(p, data, renderTimeout, m.spc.Renderer.HighlightFile)
}

func highlightFile(p string, data []byte, timeout time.Duration,
	color func(name string, data []byte) (template.HTML, string, error),
) (string, string) {
	if len(data) > maxHighlightBytes {
		return string(render.PlainFile(data)), render.PlainLanguage
	}
	type highlighted struct {
		html     template.HTML
		language string
	}
	res, err := withDeadline(p, timeout, func() (highlighted, error) {
		html, language, highlightErr := color(path.Base(p), data)
		return highlighted{html: html, language: language}, highlightErr
	})
	if err != nil {
		log.Printf("[WARN] %v, shown as plain text", err)
		return string(render.PlainFile(data)), render.PlainLanguage
	}
	return string(res.html), res.language
}

func lineCount(data []byte) int {
	res := bytes.Count(data, []byte("\n"))
	if len(data) > 0 && data[len(data)-1] != '\n' {
		res++
	}
	return res
}

func (m *mount) apiNav(w http.ResponseWriter, r *http.Request) {
	current, ok := contentPathOf(r.URL.Query().Get("path"))
	if !ok {
		jsonError(w, http.StatusBadRequest, "bad path")
		return
	}
	writeJSON(w, http.StatusOK, navResponse{
		Tree:        m.treeNodes(current),
		Breadcrumbs: view.Breadcrumbs(current),
	})
}

func (m *mount) apiMe(w http.ResponseWriter, r *http.Request) {
	sync := m.history().SyncState()
	res := meResponse{
		AuthOn:          !m.AuthDisabled,
		ReadOnly:        m.readOnly(),
		HistoryOn:       m.history().Enabled(),
		HistoryDegraded: m.history().Degraded(),
		SiteTitle:       m.Title,
		Version:         m.Version,
		Space: spaceState{
			Name:         m.spc.Name,
			Label:        m.spc.Title(),
			Kind:         m.spc.Kind,
			ReadOnly:     m.readOnly(),
			FormatOnSave: m.spc.FormatOnSave,
			Degraded:     m.history().Degraded(),
			Unpublished:  sync.Unpublished,
			SyncError:    sync.Error,
			Unsynced:     unsyncedOf(sync.Unsynced),
			Diverged:     sync.Diverged,
			PushRefused:  sync.Refused,
			CanReset:     m.canReset(r),
		},
	}
	if m.Auth != nil {
		res.User, _ = m.Auth.User(r)
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, res)
}

func (wb *Web) apiSpaces(w http.ResponseWriter, _ *http.Request) {
	res := make([]spaceEntry, 0, len(wb.Spaces))
	for _, spc := range wb.Spaces {
		res = append(res, spaceEntry{
			Name:     spc.Name,
			Label:    spc.Title(),
			URL:      spc.Prefix() + "/",
			Kind:     spc.Kind,
			ReadOnly: wb.ReadOnly || spc.ReadOnly,
		})
	}
	writeJSON(w, http.StatusOK, res)
}

func (wb *Web) apiLogin(w http.ResponseWriter, r *http.Request) {
	if wb.AuthDisabled || wb.Auth == nil {
		writeJSON(w, http.StatusOK, loginResponse{})
		return
	}
	if !wb.Auth.Allow(r) {
		w.Header().Set("Retry-After", loginRetryAfter)
		jsonError(w, http.StatusTooManyRequests, "too many attempts, wait a minute and try again")
		return
	}

	var req loginRequest
	if !decodeJSON(w, r, &req, maxLoginBody) {
		return
	}
	if !wb.Auth.Check(req.Username, req.Password) {
		wb.Auth.Failed(r)
		jsonError(w, http.StatusUnauthorized, "wrong user name or password")
		return
	}
	if err := wb.Auth.SetCookie(w, r, req.Username); err != nil {
		log.Printf("[ERROR] issue session cookie: %v", err)
		jsonError(w, http.StatusInternalServerError, "the session could not be started")
		return
	}
	writeJSON(w, http.StatusOK, loginResponse{User: req.Username})
}

func (wb *Web) apiLogout(w http.ResponseWriter, r *http.Request) {
	if wb.Auth != nil {
		wb.Auth.ClearCookie(w, r)
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeHandoff(w http.ResponseWriter, kind, target, message string) {
	writeJSON(w, http.StatusConflict, handoff{Error: message, Kind: kind, URL: target})
}

func (m *mount) canWrite(r *http.Request) bool {
	return !m.readOnly() && !auth.ReadOnlyToken(r)
}

func matchesETag(header, tag string) bool {
	for candidate := range strings.SplitSeq(header, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || strings.TrimPrefix(candidate, "W/") == tag {
			return true
		}
	}
	return false
}
