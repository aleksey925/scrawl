package server

import (
	"bytes"
	"fmt"
	"log"
	"mime"
	"net/http"
	"path"
	"runtime/debug"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aleksey925/scrawl/auth"
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/store"
)

// maxLoginBody caps the login form. It carries three short fields.
const maxLoginBody = 64 << 10

// loginRetryAfter is the wait, in seconds, a throttled login is told to take.
// The form and the JSON route answer the same one.
const loginRetryAfter = "60"

// renderDoc renders through the page cache. Rendering a large document of this
// corpus costs around 109ms and 36MB, reading it back costs a hash of the
// source, so the cache is keyed by the revision and can never go stale.
func (m *mount) renderDoc(docPath string, data []byte, rev string) (render.Result, error) {
	if res, ok := m.pages().get(m.spc.Name, docPath, rev); ok {
		return res, nil
	}
	res, err := renderWithDeadline(docPath, data, maxRenderBytes, renderTimeout, func() (render.Result, error) {
		return m.spc.Renderer.Render(data, docPath)
	})
	if err != nil {
		return render.Result{}, err
	}
	m.pages().put(m.spc.Name, docPath, rev, res)
	return res, nil
}

// renderWithDeadline runs one markdown render, refusing input too big to be
// worth rendering and giving up on one that takes too long. Goldmark is
// superlinear on some inputs (link reference definitions above all) and offers
// no cancellation, so the abandoned goroutine is left to finish: the size cap
// is what keeps it short, the deadline is what keeps the request short.
func renderWithDeadline[T any](docPath string, src []byte, limit int, timeout time.Duration,
	fn func() (T, error)) (T, error) {
	if len(src) > limit {
		var zero T
		return zero, fmt.Errorf("render %q of %d bytes: %w", docPath, len(src), store.ErrTooLarge)
	}
	return withDeadline(docPath, timeout, fn)
}

// withDeadline gives up waiting on fn once timeout has passed, and leaves it
// running: what it computes has no way to be stopped from outside.
func withDeadline[T any](docPath string, timeout time.Duration, fn func() (T, error)) (T, error) {
	var zero T
	type outcome struct {
		res T
		err error
	}
	done := make(chan outcome, 1)
	// a panic here is past rest.Recoverer, which only guards the request's own
	// goroutine, and would end the process
	go func() {
		defer func() {
			if p := recover(); p != nil {
				log.Printf("[ERROR] render %q panicked: %v\n%s", docPath, p, debug.Stack())
				done <- outcome{err: fmt.Errorf("panic: %v", p)}
			}
		}()
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
func (m *mount) rawHandler(w http.ResponseWriter, r *http.Request) {
	// a file route answers in plain text: the styled page it used to render
	// carried the whole reading chrome, and a request for an attachment has no
	// use for a sidebar full of notes
	p, ok := contentPath(r, "path")
	if !ok || p == "" {
		http.Error(w, statusMessage(http.StatusBadRequest), http.StatusBadRequest)
		return
	}

	f, fi, err := m.spc.Store.Open(p)
	if err != nil {
		status := statusOf(err)
		logFailure(r, status, err)
		http.Error(w, statusMessage(status), status)
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

// rawTextExtensions are served inline as text/plain, which no browser executes,
// and are what a file's page shows as numbered lines and the editor opens.
// Reading the source of a note or a snippet in a tab is worth keeping, and
// markdown is here on purpose: /raw/x.md is how the source of a document is
// looked at, while /doc/x.md is the rendered page. html and js are text too:
// as text/plain under the sandbox policy none of them runs.
// `.ts` is TypeScript: a video stream named so fails the byte check on opening
// and its page offers the download.
var rawTextExtensions = []string{
	".md", ".markdown", ".txt", ".text", ".log", ".csv", ".tsv",
	".py", ".go", ".rs", ".c", ".h", ".cpp", ".hpp", ".java", ".kt", ".rb",
	".pl", ".lua", ".sh", ".bash", ".zsh", ".fish", ".sql", ".r",
	".ini", ".cfg", ".conf", ".toml", ".yaml", ".yml", ".env", ".diff", ".patch",
	".json", ".jsonc", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".scss",
	".html", ".htm", ".xml", ".proto", ".graphql", ".tf", ".hcl", ".swift", ".php",
	".cs", ".scala", ".ex", ".exs", ".hs", ".ml", ".clj", ".vim",
	".cc", ".cxx", ".hh", ".hxx", ".m", ".mm", ".kts", ".gradle", ".groovy", ".sbt", ".dart",
	".vue", ".svelte", ".astro", ".sass", ".less", ".styl", ".pyi", ".pyw", ".ipynb",
	".ps1", ".psm1", ".bat", ".cmd", ".erl", ".hrl", ".elm", ".jl", ".nim", ".zig", ".sol",
	".fs", ".fsx", ".vb", ".cljs", ".cljc", ".edn", ".lisp", ".el", ".scm", ".rkt", ".pas",
	".f90", ".asm", ".s", ".cr", ".d", ".tcl", ".awk", ".nix", ".cmake", ".mk", ".tex", ".bib",
	".rst", ".adoc", ".properties", ".gql", ".jinja", ".j2", ".njk", ".hbs", ".pug", ".twig",
	".xsl", ".xsd", ".plist", ".json5", ".jsonl", ".ndjson", ".webmanifest", ".lock",
}

// rawTextNames are files that are text by their whole name, having no extension
// to say so. ".mod" is no extension of text, a tracker song is binary, so
// go.mod is here by name.
var rawTextNames = []string{
	"Dockerfile", "Containerfile", "Makefile", "GNUmakefile", "makefile", "Jenkinsfile",
	"Gemfile", "Rakefile", "Procfile", "Vagrantfile", "Brewfile", "Podfile", "Justfile",
	"justfile", "Caddyfile", "Pipfile", "go.mod", "go.sum", "LICENSE", "README",
	"AUTHORS", "CODEOWNERS", "CHANGELOG", "NOTICE",
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

// editable reports whether the editor can open a file by what a listing knows of
// it: a text name and a size the editor loads. Its bytes are checked on opening.
func editable(fi store.FileInfo) bool {
	return !fi.IsDir && isTextFile(fi.Path) && fi.Size <= maxEditableFile
}

// textContent reports whether bytes are text a page can show and the editor
// can load: valid UTF-8 with no NUL. A name on the text list is not enough,
// because a binary file can carry any name.
func textContent(data []byte) bool {
	return utf8.Valid(data) && bytes.IndexByte(data, 0) < 0
}

// rawContentType picks the media type of a stored file from its extension and
// reports whether it may be shown inline. Anything unknown is an opaque
// download: an extension nobody listed here is not worth guessing about.
func rawContentType(name string) (contentType string, inline bool) {
	ext := strings.ToLower(path.Ext(name))
	if ct, ok := rawInlineTypes[ext]; ok {
		return ct, true
	}
	if slices.Contains(rawTextExtensions, ext) || slices.Contains(rawTextNames, path.Base(name)) {
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
		w.Header().Set("Retry-After", loginRetryAfter)
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
	page := LoginPage{
		SiteTitle: wb.Title, Version: wb.Version, AppThemes: wb.appShell.base() + "themes.css",
		Logo: loginLogo(), Favicon: iconURL(wb.Version, "favicon.svg"),
		Theme: themeOf(r, wb.Version), Themes: themeOptions,
		Error: message, From: from,
	}
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
