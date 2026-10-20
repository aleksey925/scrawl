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

	"github.com/aleksey925/scrawl/auth"
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/store"
	"github.com/aleksey925/scrawl/view"
)

// pageCacheControl keeps a rendered document out of a shared cache and sends
// the browser back with the revision every time, which is what the ETag then
// answers without a body.
const pageCacheControl = "private, no-cache"

// handoff answers a path a route does not serve with the one that does. A
// client follows links it cannot classify by itself - a directory and a
// document differ only by a trailing slash - so the answer has to name the
// route to ask instead of describing the mistake.
type handoff struct {
	Error string `json:"error"`
	Kind  string `json:"kind"`
	URL   string `json:"url"`
}

type navResponse struct {
	Tree        []view.NavNode `json:"tree"`
	Breadcrumbs []view.Crumb   `json:"breadcrumbs"`
}

// meResponse is the session and the modes the app runs in.
//
// ReadOnly is the effective mode of the space being served, which is the
// server-wide guard or the space's own. There is no second field for the
// global one: every consumer of this asks "may this reader write here", and
// splitting it would offer a Save button the server refuses.
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

// spaceState is the space the app is running under, plus the live state of
// its repository. /api/spaces lists where a switcher can go; this says what
// is true of the one the reader is in.
type spaceState struct {
	Name     string `json:"name"`
	Label    string `json:"label"`
	Kind     string `json:"kind"`
	ReadOnly bool   `json:"read_only"`
	// FormatOnSave tells the editor to run prettier before it saves
	FormatOnSave bool `json:"format_on_save"`
	// Degraded is a commit that failed, so a change is on disk and not in git.
	// Unpublished is a commit the remote does not have. They are different
	// failures with different fixes, so they are two fields.
	Degraded    bool          `json:"degraded"`
	Unpublished bool          `json:"unpublished"`
	SyncError   string        `json:"sync_error"`
	Unsynced    unsyncedPaths `json:"unsynced"`
	// Diverged is measured and never read off SyncError: a merge fails for
	// other reasons too, and this is what a reset is offered on. CanReset says
	// whether this caller is one the reset routes accept.
	Diverged bool `json:"diverged"`
	// PushRefused is a push the remote turned away for want of a credential
	// that may write, which no retry fixes.
	PushRefused bool `json:"push_refused"`
	CanReset    bool `json:"can_reset"`
}

// unsyncedPaths is which notes the remote is missing. It rides on /api/me and
// on nothing else: a flag on the tree nodes, the directory rows and the search
// hits would mean a full tree walk per poll per tab to refresh a badge, where
// one set here answers every surface from one request.
//
// history has already dropped what the store hides and capped what is left, so
// the server copies it out and decides nothing.
type unsyncedPaths struct {
	Paths []string `json:"paths"`
	Many  bool     `json:"many"`
}

// spaceEntry is one row of the switcher. It carries configured, immutable
// facts only: live state is read per space through /api/me, so this endpoint
// reads no store and stays at the root with the other global routes.
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

// apiPage answers with the document the view route renders, through the same
// page cache. A markdown path that is not there is the 404 the view route
// answers too, with the shape the client needs to offer creating it.
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

// apiDir lists a directory. A folder is always its list, and its index.md is a
// row of it, tagged as the folder page.
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
	writeJSON(w, http.StatusOK, view.NewDir(p, entries, view.ItemsIn(m.spc.Store.List), editable))
}

// writeDoc answers with one rendered document.
//
// The revision is the ETag, so a reader coming back to a page revalidates it
// with one conditional request instead of carrying a copy of the revision
// around to decide whether what the browser restored is still current.
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

// writeFile answers with the page of a file that is not a note: a picture, a
// text file with its lines, or anything else as its download.
func (m *mount) writeFile(w http.ResponseWriter, r *http.Request, fi store.FileInfo) {
	contentType, _ := rawContentType(fi.Name)
	switch {
	case strings.HasPrefix(contentType, "image/"):
		// an <img> runs no script, svg included; /raw/ still downloads an svg
		// opened on its own
		writeJSON(w, http.StatusOK, view.NewFile(fi, view.FileImage))
		return
	case !editable(fi):
		writeJSON(w, http.StatusOK, view.NewFile(fi, view.FileOther))
		return
	}

	data, fi, err := m.spc.Store.Read(fi.Path)
	if err != nil {
		failJSON(w, r, err)
		return
	}
	if !textContent(data) {
		writeJSON(w, http.StatusOK, view.NewFile(fi, view.FileOther))
		return
	}
	res := view.NewFile(fi, view.FileText)
	res.Rev = store.Rev(data)
	res.EditURL = view.EditURL(fi.Path)
	res.Lines = lineCount(data)
	res.HTML, res.Language = m.highlight(fi.Path, data)
	writeJSON(w, http.StatusOK, res)
}

// highlight colors a text file up to maxHighlightBytes and under the render
// deadline; past either it is plain text, which costs one escape.
func (m *mount) highlight(p string, data []byte) (string, string) {
	if len(data) > maxHighlightBytes {
		return string(render.PlainFile(data)), render.PlainLanguage
	}
	type highlighted struct {
		html     template.HTML
		language string
	}
	res, err := withDeadline(p, renderTimeout, func() (highlighted, error) {
		html, language, highlightErr := m.spc.Renderer.HighlightFile(path.Base(p), data)
		return highlighted{html: html, language: language}, highlightErr
	})
	if err != nil {
		log.Printf("[WARN] %v, shown as plain text", err)
		return string(render.PlainFile(data)), render.PlainLanguage
	}
	return string(res.html), res.language
}

// lineCount is how many lines a text file has, a last line with no newline
// included
func lineCount(data []byte) int {
	res := bytes.Count(data, []byte("\n"))
	if len(data) > 0 && data[len(data)-1] != '\n' {
		res++
	}
	return res
}

// apiNav serves the sidebar tree and the breadcrumbs for the page named by the
// path parameter, which is what marks the branch the reader is in.
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

// apiMe names the session and the modes the app runs in, which is what the HTML
// pages carry in Base and a single page app has to ask for once.
func (m *mount) apiMe(w http.ResponseWriter, r *http.Request) {
	// one load, so the error and the paths always belong to the same attempt
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
	// a timer polls this for freshness now, so it must never come back from a
	// browser or proxy cache
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, res)
}

// apiSpaces lists what the switcher can go to. It is global because it reads
// no store, which is the one question every route in this server answers to
// land on one side of the root-versus-space boundary.
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

// apiLogin signs in from a fetch instead of a form, and starts the very same
// session the form starts. Every path charges the rate limiter the form charges
// and goes through auth.Check, which burns a bcrypt comparison whatever the
// user name was, so the answer cannot be timed to learn which names exist.
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

// apiLogout drops the session cookie. It answers no content rather than the
// redirect the form gets: a fetch would follow that one and hand the caller a
// page nobody navigated to.
func (wb *Web) apiLogout(w http.ResponseWriter, r *http.Request) {
	if wb.Auth != nil {
		wb.Auth.ClearCookie(w, r)
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeHandoff(w http.ResponseWriter, kind, target, message string) {
	writeJSON(w, http.StatusConflict, handoff{Error: message, Kind: kind, URL: target})
}

// canWrite reports whether this caller may write the notes at all, which is the
// pair of modes refuseReadOnly answers on, asked before anything is offered
// rather than after it was tried.
func (m *mount) canWrite(r *http.Request) bool {
	return !m.readOnly() && !auth.ReadOnlyToken(r)
}

// matchesETag reports whether If-None-Match names the tag. A cache is allowed
// to send back the weak form of a tag it was given, and it still names the same
// document, so the marker is stripped before comparing.
func matchesETag(header, tag string) bool {
	for candidate := range strings.SplitSeq(header, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || strings.TrimPrefix(candidate, "W/") == tag {
			return true
		}
	}
	return false
}
