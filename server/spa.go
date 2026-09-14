package server

import (
	"errors"
	"log"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/aleksey925/scrawl/auth"
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/store"
)

// the kinds every answer of the view routes carries, so a client tells the
// cases apart by a field and never by the text of an error.
const (
	kindDocument        = "document"
	kindMissingDocument = "missing-document"
	kindDirectory       = "directory"
	kindAttachment      = "attachment"
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

// pageResponse is one rendered document, the data the view template gets
// without the navigation every page carries around it.
type pageResponse struct {
	Path string `json:"path"`

	// DocPath is the file this was rendered from. It differs from Path when a
	// directory is served as its index.md, and it is what history is asked
	// about: a directory has no version of its own.
	DocPath string           `json:"doc_path"`
	Kind    string           `json:"kind"`
	Title   string           `json:"title"`
	HTML    string           `json:"html"`
	TOC     []render.Heading `json:"toc"`
	ShowTOC bool             `json:"show_toc"`
	Rev     string           `json:"rev"`
	ModTime time.Time        `json:"mod_time"`

	Breadcrumbs []Crumb `json:"breadcrumbs"`
	EditURL     string  `json:"edit_url"`
	Missing     bool    `json:"missing"`

	// CanCreate reports whether a write to this path would be allowed at all,
	// which is what the offer to create a missing page hangs on.
	CanCreate bool `json:"can_create"`
}

// dirResponse is one directory listing.
type dirResponse struct {
	Path        string     `json:"path"`
	Kind        string     `json:"kind"`
	Title       string     `json:"title"`
	Entries     []DirEntry `json:"entries"`
	ReadmeHTML  string     `json:"readme_html"`
	HasReadme   bool       `json:"has_readme"`
	Breadcrumbs []Crumb    `json:"breadcrumbs"`
}

// navNode is one node of the sidebar tree. It is not the shape /api/tree
// serves: that one answers API token clients and names only what a file
// operation needs, while this one carries what the sidebar draws.
type navNode struct {
	Name     string    `json:"name"`
	Path     string    `json:"path"`
	URL      string    `json:"url"`
	IsDir    bool      `json:"is_dir"`
	Active   bool      `json:"active"`
	Current  bool      `json:"current"`
	Children []navNode `json:"children"`
}

type navResponse struct {
	Tree        []navNode `json:"tree"`
	Breadcrumbs []Crumb   `json:"breadcrumbs"`
}

// meResponse is the session and the modes the app runs in.
type meResponse struct {
	User            string `json:"user"`
	AuthOn          bool   `json:"auth_on"`
	ReadOnly        bool   `json:"read_only"`
	HistoryOn       bool   `json:"history_on"`
	HistoryDegraded bool   `json:"history_degraded"`
	SiteTitle       string `json:"site_title"`
	Version         string `json:"version"`
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
func (wb *Web) apiPage(w http.ResponseWriter, r *http.Request) {
	p, ok := contentPath(r, "path")
	if !ok {
		jsonError(w, http.StatusBadRequest, "bad path")
		return
	}

	stat, err := wb.Store.Stat(p)
	switch {
	case errors.Is(err, store.ErrNotFound) && isMarkdown(p):
		writeJSON(w, http.StatusNotFound, pageResponse{
			Path:        p,
			DocPath:     p,
			Kind:        kindMissingDocument,
			Title:       displayName(path.Base(p)),
			TOC:         []render.Heading{},
			Breadcrumbs: breadcrumbs(p),
			EditURL:     editURL(p),
			Missing:     true,
			CanCreate:   wb.canWrite(r),
		})
		return
	case err != nil:
		failJSON(w, r, err)
		return
	case stat.IsDir:
		writeHandoff(w, kindDirectory, dirURL(p), "path is a directory, list it from /api/dir/")
		return
	case !isMarkdown(p):
		writeHandoff(w, kindAttachment, contentURL(p), "not a document, read it from /raw/")
		return
	}

	wb.writeDoc(w, r, p, p)
}

// apiDir lists a directory. One holding an index.md is that document instead,
// rendered under the directory's own path the way the directory page renders
// it: the reader asked for the directory and keeps its address.
func (wb *Web) apiDir(w http.ResponseWriter, r *http.Request) {
	p, ok := contentPath(r, "path")
	if !ok {
		jsonError(w, http.StatusBadRequest, "bad path")
		return
	}

	stat, err := wb.Store.Stat(p)
	if err != nil {
		failJSON(w, r, err)
		return
	}
	if !stat.IsDir {
		writeHandoff(w, fileKind(p), contentURL(p), "path is not a directory")
		return
	}

	entries, err := wb.Store.List(p)
	if err != nil {
		failJSON(w, r, err)
		return
	}
	if intro := indexOf(entries, "index.md"); intro != "" {
		wb.writeDoc(w, r, p, intro)
		return
	}

	title := "Home"
	if p != "" {
		title = displayName(path.Base(p))
	}
	res := dirResponse{
		Path:        p,
		Kind:        kindDirectory,
		Title:       title,
		Entries:     dirEntries(entries),
		Breadcrumbs: breadcrumbs(p),
	}
	if intro := indexOf(entries, "readme.md"); intro != "" {
		if html, introErr := wb.renderIntro(intro); introErr == nil {
			res.ReadmeHTML, res.HasReadme = string(html), true
		}
	}
	writeJSON(w, http.StatusOK, res)
}

// writeDoc answers with one rendered document, read from docPath but presented
// under navPath. The two differ for a directory served as its index.md, which
// keeps the path and the trail of the directory so that the client never has to
// leave the address it was asked to show. Only the edit link names the file.
//
// The revision is the ETag, so a reader coming back to a page revalidates it
// with one conditional request instead of carrying a copy of the revision
// around to decide whether what the browser restored is still current.
func (wb *Web) writeDoc(w http.ResponseWriter, r *http.Request, navPath, docPath string) {
	data, fi, err := wb.Store.Read(docPath)
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

	res, err := wb.renderDoc(docPath, data, rev)
	if err != nil {
		failJSON(w, r, err)
		return
	}

	toc := railTOC(res.TOC)
	writeJSON(w, http.StatusOK, pageResponse{
		Path:        navPath,
		DocPath:     docPath,
		Kind:        kindDocument,
		Title:       res.Title,
		HTML:        string(res.HTML),
		TOC:         toc,
		ShowTOC:     len(toc) >= minTOCHeadings,
		Rev:         rev,
		ModTime:     fi.ModTime,
		Breadcrumbs: breadcrumbs(navPath),
		EditURL:     editURL(docPath),
		CanCreate:   wb.canWrite(r),
	})
}

// apiNav serves the sidebar tree and the breadcrumbs for the page named by the
// path parameter, which is what marks the branch the reader is in.
func (wb *Web) apiNav(w http.ResponseWriter, r *http.Request) {
	current, ok := contentPathOf(r.URL.Query().Get("path"))
	if !ok {
		jsonError(w, http.StatusBadRequest, "bad path")
		return
	}
	writeJSON(w, http.StatusOK, navResponse{
		Tree:        navNodes(wb.treeNodes(current)),
		Breadcrumbs: breadcrumbs(current),
	})
}

// apiMe names the session and the modes the app runs in, which is what the HTML
// pages carry in Base and a single page app has to ask for once.
func (wb *Web) apiMe(w http.ResponseWriter, r *http.Request) {
	res := meResponse{
		AuthOn:          !wb.AuthDisabled,
		ReadOnly:        wb.ReadOnly,
		HistoryOn:       wb.history().Enabled(),
		HistoryDegraded: wb.history().Degraded(),
		SiteTitle:       wb.Title,
		Version:         wb.Version,
	}
	if wb.Auth != nil {
		res.User, _ = wb.Auth.User(r)
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

// fileKind names what a file is served as: markdown is rendered as a document,
// everything else is an attachment handed over by /raw/.
func fileKind(p string) string {
	if isMarkdown(p) {
		return kindDocument
	}
	return kindAttachment
}

// canWrite reports whether this caller may write the notes at all, which is the
// pair of modes refuseReadOnly answers on, asked before anything is offered
// rather than after it was tried.
func (wb *Web) canWrite(r *http.Request) bool {
	return !wb.ReadOnly && !auth.ReadOnlyToken(r)
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

func navNodes(nodes []TreeNode) []navNode {
	res := make([]navNode, 0, len(nodes))
	for _, item := range nodes {
		res = append(res, navNode{
			Name:     item.Name,
			Path:     item.Path,
			URL:      item.URL,
			IsDir:    item.IsDir,
			Active:   item.Active,
			Current:  item.Current,
			Children: navNodes(item.Children),
		})
	}
	return res
}
