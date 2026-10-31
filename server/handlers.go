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

const maxLoginBody = 64 << 10

const loginRetryAfter = "60"

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

func renderWithDeadline[T any](docPath string, src []byte, limit int, timeout time.Duration,
	fn func() (T, error)) (T, error) {
	if len(src) > limit {
		var zero T
		return zero, fmt.Errorf("render %q of %d bytes: %w", docPath, len(src), store.ErrTooLarge)
	}
	return withDeadline(docPath, timeout, fn)
}

func withDeadline[T any](docPath string, timeout time.Duration, fn func() (T, error)) (T, error) {
	var zero T
	type outcome struct {
		res T
		err error
	}
	done := make(chan outcome, 1)
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

func (m *mount) rawHandler(w http.ResponseWriter, r *http.Request) {
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
	h.Set("Content-Security-Policy", rawContentSecurityPolicy)
	h.Set("Cache-Control", "private, max-age="+strconv.Itoa(int(rawCacheTTL.Seconds())))
	h.Set("ETag", rawETag(fi))
	http.ServeContent(w, r, fi.Name, fi.ModTime, f)
}

const rawContentSecurityPolicy = "default-src 'none'; sandbox"

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

var rawTextNames = []string{
	"Dockerfile", "Containerfile", "Makefile", "GNUmakefile", "makefile", "Jenkinsfile",
	"Gemfile", "Rakefile", "Procfile", "Vagrantfile", "Brewfile", "Podfile", "Justfile",
	"justfile", "Caddyfile", "Pipfile", "go.mod", "go.sum", "LICENSE", "README",
	"AUTHORS", "CODEOWNERS", "CHANGELOG", "NOTICE",
}

var rawAttachmentTypes = map[string]string{
	".svg": "image/svg+xml",
}

func isTextFile(p string) bool {
	contentType, _ := rawContentType(p)
	return strings.HasPrefix(contentType, "text/")
}

func editable(fi store.FileInfo) bool {
	return !fi.IsDir && isTextFile(fi.Path) && fi.Size <= maxEditableFile
}

func textContent(data []byte) bool {
	return utf8.Valid(data) && bytes.IndexByte(data, 0) < 0
}

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

func rawETag(fi store.FileInfo) string {
	return fmt.Sprintf(`"%x-%x"`, fi.ModTime.UnixNano(), fi.Size)
}

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

func (wb *Web) logout(w http.ResponseWriter, r *http.Request) {
	if wb.Auth != nil {
		wb.Auth.ClearCookie(w, r)
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (wb *Web) loginForm(w http.ResponseWriter, r *http.Request, status int, message, from string) {
	page := LoginPage{
		SiteTitle: wb.Title, Version: wb.Version, AppThemes: wb.appShell.base() + appThemes,
		Logo: loginLogo(), Favicon: iconURL(wb.Version, "favicon.svg"),
		Theme: themeOf(r, wb.Version), Themes: themeOptions,
		Error: message, From: from,
	}
	wb.renderPage(w, status, "login.html", page)
}

func contentPath(r *http.Request, name string) (string, bool) {
	p := strings.Trim(r.PathValue(name), "/")
	if strings.ContainsRune(p, 0) || !utf8.ValidString(p) {
		return "", false
	}
	return p, true
}
