package server

import (
	"errors"
	"fmt"
	"html/template"
	"log"
	"mime"
	"net/http"
	"path"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aleksey925/mdserver/auth"
	"github.com/aleksey925/mdserver/render"
	"github.com/aleksey925/mdserver/search"
	"github.com/aleksey925/mdserver/store"
)

// maxLoginBody caps the login form. It carries three short fields.
const maxLoginBody = 64 << 10

// viewHandler serves "/" and "/p/{path...}": a rendered document, a directory
// listing, or the offer to create a markdown file that is not there yet.
func (wb *Web) viewHandler(w http.ResponseWriter, r *http.Request) {
	p, ok := contentPath(r, "path")
	if !ok {
		wb.errorPage(w, r, "", http.StatusBadRequest, statusMessage(http.StatusBadRequest))
		return
	}

	fi, err := wb.Store.Stat(p)
	switch {
	case errors.Is(err, store.ErrNotFound) && isMarkdown(p):
		wb.missingPage(w, r, p)
		return
	case err != nil:
		wb.failPage(w, r, p, err)
		return
	}

	switch {
	case fi.IsDir:
		wb.directoryPage(w, r, p)
	case isMarkdown(p):
		wb.documentPage(w, r, p)
	default:
		http.Redirect(w, r, "/raw/"+encodePath(p), http.StatusFound)
	}
}

// documentPage renders one markdown file as a page.
func (wb *Web) documentPage(w http.ResponseWriter, r *http.Request, docPath string) {
	data, fi, err := wb.Store.Read(docPath)
	if err != nil {
		wb.failPage(w, r, docPath, err)
		return
	}

	rev := store.Rev(data)
	res, err := wb.renderDoc(docPath, data, rev)
	if err != nil {
		wb.failPage(w, r, docPath, err)
		return
	}

	page := ViewPage{
		Base:    wb.base(r, res.Title, docPath),
		Content: res.HTML,
		TOC:     res.TOC,
		Rev:     rev,
		ModTime: fi.ModTime,
		EditURL: editURL(docPath),
	}
	wb.renderPage(w, http.StatusOK, "view.html", page)
}

// missingPage offers to create a markdown file the reader followed a link to.
// The status is still 404, but the body is the app instead of a bare message.
func (wb *Web) missingPage(w http.ResponseWriter, r *http.Request, docPath string) {
	page := ViewPage{
		Base:    wb.base(r, displayName(path.Base(docPath)), docPath),
		EditURL: editURL(docPath),
		Missing: true,
	}
	wb.renderPage(w, http.StatusNotFound, "view.html", page)
}

// directoryPage lists a directory. A directory holding an index.md is that
// document instead, and a README.md becomes the intro above the listing.
func (wb *Web) directoryPage(w http.ResponseWriter, r *http.Request, dir string) {
	entries, err := wb.Store.List(dir)
	if err != nil {
		wb.failPage(w, r, dir, err)
		return
	}

	if intro := indexOf(entries, "index.md"); intro != "" {
		wb.documentPage(w, r, intro)
		return
	}

	title := "Home"
	if dir != "" {
		title = displayName(path.Base(dir))
	}
	page := DirPage{Base: wb.base(r, title, dir), Entries: make([]DirEntry, 0, len(entries))}
	for _, ent := range entries {
		target := contentURL(ent.Path)
		if ent.IsDir {
			target = dirURL(ent.Path)
		}
		page.Entries = append(page.Entries, DirEntry{
			Name:    displayName(ent.Name),
			URL:     target,
			IsDir:   ent.IsDir,
			Size:    ent.Size,
			ModTime: ent.ModTime,
		})
	}

	if intro := indexOf(entries, "readme.md"); intro != "" {
		if html, introErr := wb.renderIntro(intro); introErr == nil {
			page.Readme, page.HasReadme = html, true
		}
	}
	wb.renderPage(w, http.StatusOK, "dir.html", page)
}

// indexOf finds a directory's own document by name, case-insensitively.
func indexOf(entries []store.FileInfo, name string) string {
	for _, ent := range entries {
		if !ent.IsDir && strings.EqualFold(ent.Name, name) {
			return ent.Path
		}
	}
	return ""
}

// renderIntro renders the README shown above a listing. A failure only costs
// the intro, so it is logged and the listing is served without it.
func (wb *Web) renderIntro(docPath string) (template.HTML, error) {
	data, _, err := wb.Store.Read(docPath)
	if err != nil {
		log.Printf("[WARN] read intro %s: %v", docPath, err)
		return "", err
	}
	res, err := wb.renderDoc(docPath, data, store.Rev(data))
	if err != nil {
		log.Printf("[WARN] render intro %s: %v", docPath, err)
		return "", err
	}
	return res.HTML, nil
}

// renderDoc renders through the page cache. Rendering a large document of this
// corpus costs around 109ms and 36MB, reading it back costs a hash of the
// source, so the cache is keyed by the revision and can never go stale.
func (wb *Web) renderDoc(docPath string, data []byte, rev string) (render.Result, error) {
	if res, ok := wb.pages().get(docPath, rev); ok {
		return res, nil
	}
	res, err := renderWithDeadline(docPath, data, maxRenderBytes, renderTimeout, func() (render.Result, error) {
		return wb.Renderer.Render(data, docPath)
	})
	if err != nil {
		return render.Result{}, err
	}
	wb.pages().put(docPath, rev, res)
	return res, nil
}

// renderWithDeadline runs one markdown render, refusing input too big to be
// worth rendering and giving up on one that takes too long. Goldmark is
// superlinear on some inputs (link reference definitions above all) and offers
// no cancellation, so the abandoned goroutine is left to finish: the size cap
// is what keeps it short, the deadline is what keeps the request short.
func renderWithDeadline[T any](docPath string, src []byte, limit int, timeout time.Duration,
	fn func() (T, error)) (T, error) {
	var zero T
	if len(src) > limit {
		return zero, fmt.Errorf("render %q of %d bytes: %w", docPath, len(src), store.ErrTooLarge)
	}

	type outcome struct {
		res T
		err error
	}
	done := make(chan outcome, 1)
	go func() {
		res, err := fn()
		done <- outcome{res: res, err: err}
	}()

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case out := <-done:
		if out.err != nil {
			return zero, fmt.Errorf("render %q: %w", docPath, out.err)
		}
		return out.res, nil
	case <-timer.C:
		return zero, fmt.Errorf("render %q: %w", docPath, errRenderTimeout)
	}
}

// rawHandler serves a file untouched, through ServeContent so that range and
// conditional requests keep working for images and pdfs.
//
// Nothing here trusts the host's mime table and nothing is ever sniffed: the
// Content-Type decides whether a browser executes the bytes, and a document
// link such as [x](evil.html) reaches this route in one click, so an attacker
// who can write one file must not be able to pick the type it comes back with.
func (wb *Web) rawHandler(w http.ResponseWriter, r *http.Request) {
	p, ok := contentPath(r, "path")
	if !ok || p == "" {
		wb.errorPage(w, r, "", http.StatusBadRequest, statusMessage(http.StatusBadRequest))
		return
	}

	f, fi, err := wb.Store.Open(p)
	if err != nil {
		wb.failPage(w, r, p, err)
		return
	}
	defer f.Close()

	contentType, inline := rawContentType(fi.Name)
	h := w.Header()
	h.Set("Content-Type", contentType)
	if !inline {
		h.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": fi.Name}))
	}
	// the app-wide policy still allows scripts from this origin, which is what
	// made /raw/ a script host; this one allows nothing at all and puts the
	// response in an opaque origin, so even a document served here is inert
	h.Set("Content-Security-Policy", rawContentSecurityPolicy)
	h.Set("Cache-Control", "private, max-age="+strconv.Itoa(int(rawCacheTTL.Seconds())))
	h.Set("ETag", rawETag(fi))
	http.ServeContent(w, r, fi.Name, fi.ModTime, f)
}

// rawContentSecurityPolicy applies to /raw/ only. sandbox without allow-scripts
// puts the response in an opaque origin, so a document that reaches a browser
// through this route cannot run script, submit a form or reach the API.
const rawContentSecurityPolicy = "default-src 'none'; sandbox"

// rawInlineTypes maps an extension to the media type served inline. Every one
// of them is a format a browser renders but cannot execute. SVG is deliberately
// missing: it is a scriptable document, and while it stays harmless inside an
// <img> (where Content-Disposition is ignored, so documents keep displaying
// their diagrams), opening /raw/x.svg directly must download it instead.
var rawInlineTypes = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".bmp":  "image/bmp",
	".ico":  "image/vnd.microsoft.icon",
	".pdf":  "application/pdf",
	".mp3":  "audio/mpeg",
	".m4a":  "audio/mp4",
	".oga":  "audio/ogg",
	".wav":  "audio/wav",
	".flac": "audio/flac",
	".mp4":  "video/mp4",
	".webm": "video/webm",
	".ogv":  "video/ogg",
	".mov":  "video/quicktime",
}

// rawTextExtensions are served inline as text/plain, which no browser executes.
// Reading the source of a note or a snippet in a tab is worth keeping, and
// markdown is here on purpose: /raw/x.md is how the source of a document is
// looked at, while /p/x.md is the rendered page.
var rawTextExtensions = []string{
	".md", ".markdown", ".txt", ".text", ".log", ".csv", ".tsv",
	".py", ".go", ".rs", ".c", ".h", ".cpp", ".hpp", ".java", ".kt", ".rb",
	".pl", ".lua", ".sh", ".bash", ".zsh", ".fish", ".sql", ".r",
	".ini", ".cfg", ".conf", ".toml", ".yaml", ".yml", ".env", ".diff", ".patch",
}

// rawAttachmentTypes are types worth naming even though they are downloaded,
// because a document may still reference them as a subresource, where the media
// type decides whether they display at all.
var rawAttachmentTypes = map[string]string{
	".svg": "image/svg+xml",
}

// isTextFile reports whether a path holds text the editor can load. It shares
// the raw serving table, so what the editor may open and what is safe to show
// inline cannot drift apart.
func isTextFile(p string) bool {
	contentType, _ := rawContentType(p)
	return strings.HasPrefix(contentType, "text/")
}

// rawContentType picks the media type of a stored file from its extension and
// reports whether it may be shown inline. Anything unknown is an opaque
// download: an extension nobody listed here is not worth guessing about.
func rawContentType(name string) (contentType string, inline bool) {
	ext := strings.ToLower(path.Ext(name))
	if ct, ok := rawInlineTypes[ext]; ok {
		return ct, true
	}
	if slices.Contains(rawTextExtensions, ext) {
		return "text/plain; charset=utf-8", true
	}
	if ct, ok := rawAttachmentTypes[ext]; ok {
		return ct, false
	}
	return "application/octet-stream", false
}

// rawETag identifies one version of a stored file. It is built from the size
// and the modification time and not from the content digest the store uses for
// markdown: hashing an attachment would mean reading all of it on every
// request, which is exactly what ServeContent avoids.
func rawETag(fi store.FileInfo) string {
	return fmt.Sprintf(`"%x-%x"`, fi.ModTime.UnixNano(), fi.Size)
}

// editHandler serves the editor for a markdown path, existing or not.
func (wb *Web) editHandler(w http.ResponseWriter, r *http.Request) {
	if wb.ReadOnly {
		wb.errorPage(w, r, "", http.StatusForbidden, statusMessage(http.StatusForbidden))
		return
	}
	p, ok := contentPath(r, "path")
	if !ok || p == "" || !isMarkdown(p) {
		wb.errorPage(w, r, "", http.StatusBadRequest, statusMessage(http.StatusBadRequest))
		return
	}

	data, _, err := wb.Store.Read(p)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		wb.failPage(w, r, p, err)
		return
	}

	page := EditPage{
		Base:    wb.base(r, displayName(path.Base(p)), p),
		ViewURL: "/p/" + encodePath(p),
		IsNew:   err != nil,
	}
	if err == nil {
		page.Content, page.Rev = string(data), store.Rev(data)
	}
	wb.renderPage(w, http.StatusOK, "edit.html", page)
}

// searchHandler serves the full text search page.
func (wb *Web) searchHandler(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))

	start := time.Now()
	var hits []search.Hit
	if query != "" && wb.Index != nil {
		hits = wb.Index.Search(query, searchPageLimit)
	}

	page := SearchPage{
		Base:    wb.base(r, "Search", ""),
		Query:   query,
		Hits:    hits,
		Elapsed: time.Since(start).Round(time.Microsecond),
	}
	wb.renderPage(w, http.StatusOK, "search.html", page)
}

// loginPage shows the sign-in form.
func (wb *Web) loginPage(w http.ResponseWriter, r *http.Request) {
	if wb.AuthDisabled || wb.Auth == nil {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}
	if _, ok := wb.Auth.User(r); ok {
		http.Redirect(w, r, auth.SafeRedirect(r.URL.Query().Get("from")), http.StatusFound)
		return
	}
	wb.loginForm(w, r, http.StatusOK, "", auth.SafeRedirect(r.URL.Query().Get("from")))
}

// loginSubmit checks the credentials and starts a session.
func (wb *Web) loginSubmit(w http.ResponseWriter, r *http.Request) {
	if wb.AuthDisabled || wb.Auth == nil {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	if !wb.Auth.Allow(r) {
		w.Header().Set("Retry-After", "60")
		wb.loginForm(w, r, http.StatusTooManyRequests, "Too many attempts, wait a minute and try again", "/")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxLoginBody)
	if err := r.ParseForm(); err != nil {
		wb.loginForm(w, r, http.StatusBadRequest, "The form could not be read", "/")
		return
	}
	from := auth.SafeRedirect(r.PostFormValue("from"))

	if !wb.Auth.Check(r.PostFormValue("username"), r.PostFormValue("password")) {
		wb.Auth.Failed(r)
		wb.loginForm(w, r, http.StatusUnauthorized, "Wrong user name or password", from)
		return
	}
	if err := wb.Auth.SetCookie(w, r, r.PostFormValue("username")); err != nil {
		log.Printf("[ERROR] issue session cookie: %v", err)
		wb.loginForm(w, r, http.StatusInternalServerError, "The session could not be started", from)
		return
	}
	http.Redirect(w, r, from, http.StatusSeeOther)
}

// logout drops the session cookie.
func (wb *Web) logout(w http.ResponseWriter, r *http.Request) {
	if wb.Auth != nil {
		wb.Auth.ClearCookie(w, r)
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (wb *Web) loginForm(w http.ResponseWriter, r *http.Request, status int, message, from string) {
	page := LoginPage{SiteTitle: wb.Title, Version: wb.Version, Theme: themeOf(r), Error: message, From: from}
	wb.renderPage(w, status, "login.html", page)
}

// contentPath pulls the content path out of the URL. ServeMux has already
// decoded the percent escapes, and the store is the security boundary for what
// the path may point at, so only input no path can ever hold is refused here.
func contentPath(r *http.Request, name string) (string, bool) {
	p := strings.Trim(r.PathValue(name), "/")
	if strings.ContainsRune(p, 0) || !utf8.ValidString(p) {
		return "", false
	}
	return p, true
}
