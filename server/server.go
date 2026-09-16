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

// contentSecurityPolicy is strict on purpose: every script and stylesheet the
// app needs is embedded and served from this origin, and nothing inline is ever
// rendered into a script, so script-src stays 'self' with nothing to nonce.
// TestNoInlineScripts guards that.
//
// Styles need three directives rather than one. Mantine injects a <style>
// element for its css variables, which the nonce covers, and it also writes
// style attributes, which a nonce can never cover: 'unsafe-inline' is ignored
// whenever a nonce sits in the same directive, so the two cases cannot share
// one. A note cannot reach style-src-attr regardless, because the bluemonday
// policy in render never lets a style attribute through sanitization. The plain
// style-src is the fallback for a browser that does not know the -elem and
// -attr forms, which would otherwise drop to default-src and block every sheet.
//
// Images are the one loose end: a document may embed a remote one, and the
// stylesheet draws its icons from data: urls.
func contentSecurityPolicy(nonce string) string {
	return "default-src 'none'; base-uri 'none'; form-action 'self'; " +
		"frame-ancestors 'none'; connect-src 'self'; font-src 'self'; manifest-src 'self'; " +
		"style-src 'self' 'unsafe-inline'; " +
		"style-src-elem 'self' 'nonce-" + nonce + "'; style-src-attr 'unsafe-inline'; " +
		"img-src 'self' data: https:; script-src 'self'"
}

// barColorLight and barColorDark are the browser and home screen chrome colors.
// base.html ships them as prefers-color-scheme metas and theme.js swaps between
// them; the manifest carries one, so a change has to land in all three.
const (
	barColorLight = "#ffffff"
	barColorDark  = "#1c1c1e"
)

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
	Projects []*Project
	Auth     *auth.Service

	byName    map[string]*Project
	templates *template.Template
	appShell  *appShell

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

// Invalidate drops the rendered HTML cached for a content path of one project.
// main calls it from that project's store watcher, so an edit made outside the
// app shows up at once.
func (wb *Web) Invalidate(project, contentPath string) { wb.pages().invalidate(project, contentPath) }

// pages returns the render cache, building it on first use so that a watcher
// event arriving before the first request has somewhere to go.
func (wb *Web) pages() *pageCache {
	wb.cacheOnce.Do(func() { wb.cache = newPageCache(pageCacheEntries, pageCacheBytes) })
	return wb.cache
}

func (wb *Web) router() (http.Handler, error) {
	if len(wb.Projects) == 0 {
		return nil, errors.New("no project configured")
	}
	if err := wb.parseTemplates(); err != nil {
		return nil, err
	}
	assetsFS, err := fs.Sub(content, "assets")
	if err != nil {
		return nil, fmt.Errorf("sub fs for assets: %w", err)
	}
	if wb.appShell, err = newAppShell(assetsFS); err != nil {
		return nil, fmt.Errorf("build app shell: %w", err)
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

	// at the root, because the scope a manifest can claim is its own directory
	// and anywhere below /static/ would install an app that owns only that
	router.HandleFunc("GET /manifest.webmanifest", wb.manifestHandler)

	router.HandleFunc("GET /login", wb.loginPage)
	router.HandleFunc("GET /api/projects", wb.apiProjects)

	// a path that belongs to no project reaches this one, which means an
	// unknown project name or a stray root path. It answers a plain 404 and not
	// the app shell: there is no project, so there is no base it could honestly
	// hand the client. Each mount registers a shell fallback of its own.
	router.NotFoundHandler(plainNotFound)

	// the root picks nothing and resolves nothing, it only says where a browser
	// lands. 302 and not 308, because the first project is a deployment setting
	// the operator changes by editing the configuration.
	router.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, wb.Projects[0].Prefix()+"/", http.StatusFound)
	})

	// everything that changes state, plus the login form itself, has to survive
	// a cross-site POST: Go's CrossOriginProtection checks Sec-Fetch-Site
	mutating := router.With(auth.CSRF())
	mutating.HandleFunc("POST /login", wb.loginSubmit)
	mutating.HandleFunc("POST /logout", wb.logout)
	mutating.HandleFunc("POST /api/login", wb.apiLogin)
	mutating.HandleFunc("POST /api/logout", wb.apiLogout)

	wb.byName = make(map[string]*Project, len(wb.Projects))
	for _, prj := range wb.Projects {
		if _, dup := wb.byName[prj.Name]; dup {
			return nil, fmt.Errorf("two projects named %q", prj.Name)
		}
		wb.byName[prj.Name] = prj
		wb.projectRoutes(router.Mount(prj.Prefix()), prj)
	}

	return router, nil
}

// projectRoutes registers everything one project owns under its own prefix.
// The order matters: the two catch-alls come last, so Go's pattern matching
// prefers any explicit route over them.
func (wb *Web) projectRoutes(g *routegroup.Bundle, prj *Project) {
	m := &mount{Web: wb, prj: prj}

	g.HandleFunc("GET /{$}", m.appHandler)
	g.HandleFunc("GET /doc/{path...}", m.docHandler)
	g.HandleFunc("GET /edit/{path...}", m.appHandler)
	g.HandleFunc("GET /history/{path...}", m.appHandler)
	g.HandleFunc("GET /search", m.appHandler)
	g.HandleFunc("GET /raw/{path...}", m.rawHandler)
	g.HandleFunc("GET /api/tree", m.apiTree)
	g.HandleFunc("GET /api/file/{path...}", m.apiFileGet)
	g.HandleFunc("GET /api/search", m.apiSearch)
	g.HandleFunc("GET /api/history/{path...}", m.apiHistory)
	g.HandleFunc("GET /api/page/{path...}", m.apiPage)
	g.HandleFunc("GET /api/dir/{path...}", m.apiDir)
	g.HandleFunc("GET /api/nav", m.apiNav)
	g.HandleFunc("GET /api/me", m.apiMe)

	mutating := g.With(auth.CSRF())
	mutating.HandleFunc("PUT /api/file/{path...}", m.apiFileSave)
	mutating.HandleFunc("POST /api/file/{path...}", m.apiFileCreate)
	mutating.HandleFunc("DELETE /api/file/{path...}", m.apiFileDelete)
	mutating.HandleFunc("POST /api/move", m.apiMove)
	mutating.HandleFunc("POST /api/upload/{dir...}", m.apiUpload)
	mutating.HandleFunc("POST /api/preview", m.apiPreview)
	mutating.HandleFunc("POST /api/history/restore/{path...}", m.apiHistoryRestore)

	// NotFoundHandler is global whichever bundle registers it and knows no
	// prefix, so it cannot boot the app for a path inside a project. These two
	// are what does, and the API one keeps an unknown API path from being
	// answered with HTML.
	g.HandleFunc("GET /api/{path...}", func(w http.ResponseWriter, _ *http.Request) {
		jsonError(w, http.StatusNotFound, "not found")
	})
	g.HandleFunc("GET /{path...}", m.notFoundHandler)
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

// manifestHandler answers the web app manifest, which is what lets a phone keep
// the notes on its home screen and run them without browser chrome. It is built
// here rather than embedded as a file: the name on the home screen is the
// configured site title, and the icons carry the cache busting version segment.
func (wb *Web) manifestHandler(w http.ResponseWriter, r *http.Request) {
	type icon struct {
		Src     string `json:"src"`
		Sizes   string `json:"sizes"`
		Type    string `json:"type"`
		Purpose string `json:"purpose"`
	}
	res := struct {
		Name            string `json:"name"`
		ShortName       string `json:"short_name"`
		StartURL        string `json:"start_url"`
		Scope           string `json:"scope"`
		Display         string `json:"display"`
		ThemeColor      string `json:"theme_color"`
		BackgroundColor string `json:"background_color"`
		Icons           []icon `json:"icons"`
	}{
		Name:      wb.Title,
		ShortName: wb.Title,
		StartURL:  "/",
		Scope:     "/",
		Display:   "standalone",
		// the light bar color: a manifest carries one, and the metas in the
		// document head are what actually follow the reader's theme
		ThemeColor:      barColorLight,
		BackgroundColor: barColorLight,
		Icons: []icon{
			{Src: "/static/" + wb.Version + "/icons/icon-192.png", Sizes: "192x192", Type: "image/png", Purpose: "any"},
			{Src: "/static/" + wb.Version + "/icons/icon-512.png", Sizes: "512x512", Type: "image/png", Purpose: "any"},
		},
	}

	body, err := json.Marshal(res)
	if err != nil {
		http.Error(w, "cannot build the manifest", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
	if _, err := w.Write(body); err != nil {
		log.Printf("[DEBUG] write manifest response: %v", err)
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

// securityHeaders sets the response headers that do not depend on the route and
// mints the style nonce, which has to be fresh per response or it authorizes
// nothing.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nonce, err := newNonce()
		if err != nil {
			log.Printf("[ERROR] mint style nonce: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Content-Security-Policy", contentSecurityPolicy(nonce))
		next.ServeHTTP(w, r.WithContext(withNonce(r.Context(), nonce)))
	})
}

func (wb *Web) parseTemplates() error {
	tmpl, err := template.ParseFS(content, "templates/*.html")
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
