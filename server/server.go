// Package server implements the HTTP layer of scrawl: the http.Server
// lifecycle, routing, the middleware stack and the embedded templates and
// static assets.
package server

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/go-pkgz/lgr"
	"github.com/go-pkgz/rest"
	"github.com/go-pkgz/rest/logger"
	"github.com/go-pkgz/routegroup"

	"github.com/aleksey925/scrawl/auth"
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/search"
	"github.com/aleksey925/scrawl/store"
)

//go:embed templates assets
var content embed.FS

const (
	throttleLimit          = 64
	staticCacheTTL         = 365 * 24 * time.Hour
	rawCacheTTL            = 5 * time.Minute
	defaultShutdownTimeout = 5 * time.Second

	// maxJSONBody caps every JSON endpoint. The biggest legitimate payload is
	// a whole document being saved, which is far below it.
	maxJSONBody = 4 << 20

	// maxPreviewBody caps /api/preview. It is an editor buffer and not a file,
	// and rendering is superlinear in the input, so the preview gets much less
	// room than a save.
	maxPreviewBody = 512 << 10

	// maxEditableFile caps what GET /api/file will read into memory and escape
	// into a JSON string. A document past it is not editable in a textarea
	// anyway, and reading it costs several times its size in RSS.
	maxEditableFile = 2 << 20

	// maxRenderBytes caps the source a page render is attempted on. Goldmark is
	// quadratic on some inputs, so an unbounded document is a CPU sink.
	maxRenderBytes = 2 << 20

	// renderTimeout bounds how long a request waits for a render.
	renderTimeout = 10 * time.Second

	pageCacheEntries = 256
	pageCacheBytes   = 64 << 20

	searchPageLimit = 50
	searchAPILimit  = 20
)

// emptyStyleHash is the sha256 of the empty string, so it permits exactly one
// inline style: style="". Mermaid writes that attribute onto dozens of svg
// nodes per diagram, and every one of them was a console error that buried the
// violations worth reading. It grants nothing - a hash matches the declaration
// text, and this one matches no declarations at all - and 'unsafe-hashes',
// which is what makes a hash apply to a style attribute in the first place,
// still needs a matching hash for any other value.
const emptyStyleHash = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='"

// contentSecurityPolicy is strict on purpose: every script and stylesheet the
// app needs is embedded and served from this origin, and the theme bootstrap
// lives in boot.js rather than in an inline block, so no nonce and no hash has
// to be rendered into a template. TestNoInlineScripts guards that.
//
// Images are the one loose end: a document may embed a remote one, and the
// stylesheet draws its icons from data: urls.
const contentSecurityPolicy = "default-src 'none'; base-uri 'none'; form-action 'self'; " +
	"frame-ancestors 'none'; connect-src 'self'; font-src 'self'; " +
	"style-src 'self' 'unsafe-hashes' " + emptyStyleHash + "; " +
	"img-src 'self' data: https:; script-src 'self'"

// gzipContentTypes lists what is worth compressing. rest.Gzip decides on the
// content type of the response rather than on the extension of the request, so
// a png, a woff2, a pdf or an unknown attachment - all of them already
// compressed or opaque - go out untouched and only spend cpu here.
var gzipContentTypes = []string{
	"text/html", "text/css", "text/plain", "text/xml", "text/javascript",
	"application/javascript", "application/json", "image/svg+xml",
}

// Config holds every knob the web layer needs. main maps its options onto it
// field by field, no other package reads the command line.
type Config struct {
	ListenAddr   string // address to listen on, host:port
	Title        string // site title shown in the UI
	Version      string // build revision, also the static assets cache buster
	ReadOnly     bool   // refuse every write endpoint
	TrustedProxy bool   // trust X-Forwarded-For and X-Forwarded-Proto
	MaxUpload    int64  // upload size cap in bytes
	UploadDir    string // one shared directory for uploads, empty keeps them next to the document
	AuthDisabled bool   // serve without authentication

	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	ShutdownTimeout   time.Duration
}

// Web is the http server of scrawl, built as a struct literal in main.
type Web struct {
	Config
	Store    *store.Store
	Renderer *render.Renderer
	Index    *search.Index
	Auth     *auth.Service
	History  History

	templates *template.Template

	cacheOnce sync.Once
	cache     *pageCache
}

// Run starts the server and blocks until ctx is canceled or the server fails.
func (wb *Web) Run(ctx context.Context) error {
	if wb.ListenAddr == "" {
		return errors.New("listen address cannot be empty")
	}

	router, err := wb.router()
	if err != nil {
		return fmt.Errorf("make router: %w", err)
	}

	srv := &http.Server{
		Addr:              wb.ListenAddr,
		Handler:           router,
		ReadHeaderTimeout: wb.ReadHeaderTimeout,
		ReadTimeout:       wb.ReadTimeout,
		WriteTimeout:      wb.WriteTimeout,
		IdleTimeout:       wb.IdleTimeout,
	}

	serverErrors := make(chan error, 1)
	go func() {
		log.Printf("[INFO] starting server on %s", wb.ListenAddr)
		serverErrors <- srv.ListenAndServe()
	}()

	select {
	case err := <-serverErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("server failed: %w", err)
	case <-ctx.Done():
		log.Printf("[DEBUG] server shutdown initiated")
		return wb.shutdown(ctx, srv)
	}
}

func (wb *Web) shutdown(ctx context.Context, srv *http.Server) error {
	timeout := wb.ShutdownTimeout
	if timeout <= 0 {
		timeout = defaultShutdownTimeout
	}

	// ctx is the one that triggered the shutdown and is already canceled, so
	// strip its cancelation, otherwise the drain aborts before it starts
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), timeout)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("graceful shutdown: %w", err)
	}

	log.Printf("[INFO] server shutdown completed")
	return nil
}

// Invalidate drops the rendered HTML cached for a content path. main calls it
// from the store watcher, so an edit made outside the app shows up at once.
func (wb *Web) Invalidate(contentPath string) { wb.pages().invalidate(contentPath) }

// pages returns the render cache, building it on first use so that a watcher
// event arriving before the first request has somewhere to go.
func (wb *Web) pages() *pageCache {
	wb.cacheOnce.Do(func() { wb.cache = newPageCache(pageCacheEntries, pageCacheBytes) })
	return wb.cache
}

func (wb *Web) router() (http.Handler, error) {
	if err := wb.parseTemplates(); err != nil {
		return nil, err
	}
	assetsFS, err := fs.Sub(content, "assets")
	if err != nil {
		return nil, fmt.Errorf("sub fs for assets: %w", err)
	}

	router := routegroup.New(http.NewServeMux())
	router.Use(rest.Trace, rest.Recoverer(lgr.Default()), securityHeaders)
	router.Use(rest.Gzip(gzipContentTypes...))
	// RealIP rewrites RemoteAddr from a header the client controls, which would
	// hand every visitor a fresh bucket in the login rate limiter, so it is only
	// installed when a proxy in front is known to overwrite that header
	if wb.TrustedProxy {
		router.Use(rest.RealIP)
	}
	router.Use(rest.Throttle(throttleLimit))
	router.Use(logger.New(logger.Log(lgr.Default()), logger.Prefix("[DEBUG]")).Handler)
	if wb.Auth != nil {
		router.Use(wb.Auth.Middleware)
	}
	router.Use(wb.appInfo)

	// rest.Ping is not used: it answers any path ending in /ping, before auth,
	// so /p/anything/ping would be an unauthenticated route and a document
	// really named ping would be unreachable
	router.HandleFunc("GET /ping", pingHandler)

	// the version segment is part of the URL only to bust the cache, lookup
	// ignores it so that an old page keeps working after a redeploy
	router.With(rest.CacheControl(staticCacheTTL, wb.Version)).
		HandleFunc("GET /static/{version}/{path...}", wb.staticHandler(assetsFS))

	router.HandleFunc("GET /login", wb.loginPage)
	router.HandleFunc("GET /{$}", wb.viewHandler)
	router.HandleFunc("GET /p/{path...}", wb.viewHandler)
	router.HandleFunc("GET /raw/{path...}", wb.rawHandler)
	router.HandleFunc("GET /edit/{path...}", wb.editHandler)
	router.HandleFunc("GET /history/{path...}", wb.historyPage)
	router.HandleFunc("GET /search", wb.searchHandler)
	router.HandleFunc("GET /api/tree", wb.apiTree)
	router.HandleFunc("GET /api/file/{path...}", wb.apiFileGet)
	router.HandleFunc("GET /api/search", wb.apiSearch)
	router.HandleFunc("GET /api/history/{path...}", wb.apiHistory)

	// everything that changes state, plus the login form itself, has to survive
	// a cross-site POST: Go's CrossOriginProtection checks Sec-Fetch-Site
	mutating := router.With(auth.CSRF())
	mutating.HandleFunc("POST /login", wb.loginSubmit)
	mutating.HandleFunc("POST /logout", wb.logout)
	mutating.HandleFunc("PUT /api/file/{path...}", wb.apiFileSave)
	mutating.HandleFunc("POST /api/file/{path...}", wb.apiFileCreate)
	mutating.HandleFunc("DELETE /api/file/{path...}", wb.apiFileDelete)
	mutating.HandleFunc("POST /api/move", wb.apiMove)
	mutating.HandleFunc("POST /api/upload/{dir...}", wb.apiUpload)
	mutating.HandleFunc("POST /api/preview", wb.apiPreview)
	mutating.HandleFunc("POST /api/history/restore/{path...}", wb.apiHistoryRestore)

	return router, nil
}

// staticHandler serves the embedded assets plus the highlighting stylesheet,
// which render generates instead of shipping it as a file.
func (wb *Web) staticHandler(assetsFS fs.FS) http.HandlerFunc {
	chroma := render.ChromaCSS()
	return func(w http.ResponseWriter, r *http.Request) {
		switch assetPath := r.PathValue("path"); assetPath {
		case "":
			http.NotFound(w, r)
		case "css/chroma.css":
			w.Header().Set("Content-Type", "text/css; charset=utf-8")
			http.ServeContent(w, r, "chroma.css", time.Time{}, bytes.NewReader(chroma))
		default:
			http.ServeFileFS(w, r, assetsFS, assetPath)
		}
	}
}

// pingHandler answers the container healthcheck without a session.
func pingHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if _, err := w.Write([]byte("pong")); err != nil {
		log.Printf("[DEBUG] write ping response: %v", err)
	}
}

// appInfo names the running build, but only to a caller that already has a
// session: the version is branch-sha-timestamp, which tells anybody who asks
// exactly which commit is deployed.
func (wb *Web) appInfo(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if wb.Auth == nil {
			next.ServeHTTP(w, r)
			return
		}
		if _, ok := wb.Auth.User(r); ok {
			h := w.Header()
			h.Set("App-Name", "scrawl")
			h.Set("App-Version", wb.Version)
			h.Set("Author", "aleksey925")
		}
		next.ServeHTTP(w, r)
	})
}

// securityHeaders sets the response headers that do not depend on the route.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		next.ServeHTTP(w, r)
	})
}

func (wb *Web) parseTemplates() error {
	funcs := template.FuncMap{
		// a template that pasted a content path straight into an href would
		// leave the segments unescaped, and html/template normalizes a whole
		// url rather than a path: a document named "a?b.md" would link to a
		// query string. These two are the same builders the JSON API uses.
		"contentURL": contentURL,
		"editURL":    editURL,
		"historyURL": historyURL,
		"searchURL":  searchURL,

		// a search snippet arrives escaped with only <mark> left in it, so it
		// goes into the page as it is. Anything that is not already marked safe
		// is escaped here, so a later caller cannot turn this into a hole.
		"safeHTML": func(v any) template.HTML {
			if html, ok := v.(template.HTML); ok {
				return html
			}
			//nolint:gosec // G203: the value is escaped on this very line
			return template.HTML(template.HTMLEscapeString(fmt.Sprint(v)))
		},
	}
	tmpl, err := template.New("scrawl").Funcs(funcs).ParseFS(content, "templates/*.html")
	if err != nil {
		return fmt.Errorf("parse templates: %w", err)
	}
	wb.templates = tmpl
	return nil
}

// renderPage executes a template into a buffer first, so a template failure
// cannot leave half a page on the wire with a 200 already sent.
func (wb *Web) renderPage(w http.ResponseWriter, status int, name string, data any) {
	var buf bytes.Buffer
	if err := wb.templates.ExecuteTemplate(&buf, name, data); err != nil {
		log.Printf("[ERROR] render template %s: %v", name, err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if _, err := buf.WriteTo(w); err != nil {
		log.Printf("[DEBUG] write page %s: %v", name, err)
	}
}

// errorPage answers an HTML route with the styled error page.
func (wb *Web) errorPage(w http.ResponseWriter, r *http.Request, contentPath string, status int, message string) {
	page := ErrorPage{
		Base:    wb.base(r, message, contentPath),
		Code:    status,
		Message: message,
	}
	wb.renderPage(w, status, "error.html", page)
}

// failPage maps a store error onto the error page.
func (wb *Web) failPage(w http.ResponseWriter, r *http.Request, contentPath string, err error) {
	status := statusOf(err)
	logFailure(r, status, err)
	message := statusMessage(status)
	if errors.Is(err, store.ErrPermission) {
		message = permissionMessage
	}
	wb.errorPage(w, r, contentPath, status, message)
}

// logFailure records the failures nobody can diagnose from the response alone:
// a bug behind a 500, and a permission denied, which is a deployment problem
// the owner only ever sees in the container log.
func logFailure(r *http.Request, status int, err error) {
	if status != http.StatusInternalServerError && !errors.Is(err, store.ErrPermission) {
		return
	}
	log.Printf("[ERROR] %s %s: %v", r.Method, r.URL.Path, err)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		log.Printf("[ERROR] encode json response: %v", err)
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if _, err := w.Write(body); err != nil {
		log.Printf("[DEBUG] write json response: %v", err)
	}
}

func jsonError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// failJSON maps a store error onto a JSON error response.
func failJSON(w http.ResponseWriter, r *http.Request, err error) {
	status := statusOf(err)
	logFailure(r, status, err)
	jsonError(w, status, errMessage(err))
}
