package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-pkgz/lgr"
	"github.com/go-pkgz/rest"
	"github.com/go-pkgz/rest/logger"
	"github.com/go-pkgz/routegroup"

	"github.com/aleksey925/scrawl/auth"
	"github.com/aleksey925/scrawl/gzassets"
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/store"
	"github.com/aleksey925/scrawl/theme"
)

//go:embed templates
var templateFiles embed.FS

var assets = gzassets.Sub(assetFiles, assetDir)

const (
	throttleLimit          = 64
	staticCacheTTL         = 365 * 24 * time.Hour
	rawCacheTTL            = 5 * time.Minute
	defaultShutdownTimeout = 5 * time.Second

	maxJSONBody = 4 << 20

	maxPreviewBody = 512 << 10

	maxEditableFile = 2 << 20

	maxRenderBytes = 2 << 20

	renderTimeout = 10 * time.Second

	maxHighlightBytes = 256 << 10

	pageCacheEntries = 256
	pageCacheBytes   = 64 << 20

	searchPageLimit = 50
	searchAPILimit  = 20

	searchTimeout = 2 * time.Second
)

const contentSecurityPolicy = "default-src 'none'; base-uri 'none'; form-action 'self'; " +
	"frame-ancestors 'none'; connect-src 'self'; font-src 'self'; manifest-src 'self'; " +
	"style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; script-src 'self' 'wasm-unsafe-eval'"

var gzipContentTypes = []string{
	"text/html", "text/css", "text/plain", "text/xml", "text/javascript",
	"application/javascript", "application/json", "image/svg+xml",
}

type Config struct {
	ListenAddr   string
	Title        string
	Version      string
	ReadOnly     bool
	TrustedProxy bool
	MaxUpload    int64
	UploadDir    string
	AuthDisabled bool

	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	ShutdownTimeout   time.Duration
}

type Web struct {
	Config
	Spaces          []*Space
	Auth            *auth.Service
	Formatter       Formatter
	DiagramRenderer DiagramRenderer

	byName    map[string]*Space
	templates *template.Template
	appShell  *appShell

	cacheOnce sync.Once
	cache     *pageCache
}

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

	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), timeout)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("graceful shutdown: %w", err)
	}

	log.Printf("[INFO] server shutdown completed")
	return nil
}

func (wb *Web) Invalidate(space, contentPath string) { wb.pages().invalidate(space, contentPath) }

func (wb *Web) pages() *pageCache {
	wb.cacheOnce.Do(func() { wb.cache = newPageCache(pageCacheEntries, pageCacheBytes) })
	return wb.cache
}

func (wb *Web) router() (http.Handler, error) {
	if len(wb.Spaces) == 0 {
		return nil, errors.New("no space configured")
	}
	if err := wb.parseTemplates(); err != nil {
		return nil, err
	}
	var err error
	if wb.appShell, err = newAppShell(assets); err != nil {
		return nil, fmt.Errorf("build app shell: %w", err)
	}

	router := routegroup.New(http.NewServeMux())
	router.Use(rest.Trace, rest.Recoverer(lgr.Default()), securityHeaders)
	router.Use(rest.Gzip(gzipContentTypes...))
	if wb.TrustedProxy {
		router.Use(rest.RealIP)
	}
	router.Use(rest.Throttle(throttleLimit))
	router.Use(logger.New(logger.Log(lgr.Default()), logger.Prefix("[DEBUG]")).Handler)
	if wb.Auth != nil {
		router.Use(wb.Auth.Middleware)
	}
	router.Use(wb.appInfo)

	router.HandleFunc("GET /ping", pingHandler)

	router.With(rest.CacheControl(staticCacheTTL, wb.Version)).
		HandleFunc("GET /static/{version}/{path...}", wb.staticHandler(assets))
	router.HandleFunc("GET /static/{version}/"+appDir+"/{path...}", wb.appAssetHandler(assets))
	router.With(rest.CacheControl(staticCacheTTL, wb.Version)).
		HandleFunc("GET /static/{version}/"+plantumlDir+"/{file}", plantumlLibraryHandler)

	router.HandleFunc("GET /manifest.webmanifest", wb.manifestHandler)

	router.HandleFunc("GET /login", wb.loginPage)
	router.HandleFunc("GET /api/spaces", wb.apiSpaces)

	router.NotFoundHandler(plainNotFound)

	router.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, wb.Spaces[0].Prefix()+"/", http.StatusFound)
	})

	mutating := router.With(auth.CSRF())
	mutating.HandleFunc("POST /login", wb.loginSubmit)
	mutating.HandleFunc("POST /logout", wb.logout)
	mutating.HandleFunc("POST /api/login", wb.apiLogin)
	mutating.HandleFunc("POST /api/logout", wb.apiLogout)

	wb.byName = make(map[string]*Space, len(wb.Spaces))
	for _, spc := range wb.Spaces {
		if _, dup := wb.byName[spc.Name]; dup {
			return nil, fmt.Errorf("two spaces named %q", spc.Name)
		}
		wb.byName[spc.Name] = spc
		wb.spaceRoutes(router.Mount(spc.Prefix()), spc)
	}

	return router, nil
}

func (wb *Web) spaceRoutes(g *routegroup.Bundle, spc *Space) {
	m := &mount{Web: wb, spc: spc}

	g.HandleFunc("GET /{$}", m.appHandler)
	g.HandleFunc("GET /doc/{path...}", m.docHandler)
	g.HandleFunc("GET /edit/{path...}", m.appHandler)
	g.HandleFunc("GET /history/{path...}", m.appHandler)
	g.HandleFunc("GET /search", m.appHandler)
	g.HandleFunc("GET /recent", m.appHandler)
	g.HandleFunc("GET /raw/{path...}", m.rawHandler)
	g.HandleFunc("GET /api/tree", m.apiTree)
	g.HandleFunc("GET /api/file/{path...}", m.apiFileGet)
	g.HandleFunc("GET /api/search", m.apiSearch)
	g.HandleFunc("GET /api/history/{path...}", m.apiHistory)
	g.HandleFunc("GET /api/page/{path...}", m.apiPage)
	g.HandleFunc("GET /api/dir/{path...}", m.apiDir)
	g.HandleFunc("GET /api/nav", m.apiNav)
	g.HandleFunc("GET /api/me", m.apiMe)
	g.HandleFunc("GET /api/export/{path...}", m.apiExport)

	if spc.Webhook != nil {
		g.HandleFunc("POST /hook", m.hookHandler)
		g.HandleFunc("GET /hook", m.hookHandler)
	}

	mutating := g.With(auth.CSRF())
	mutating.HandleFunc("PUT /api/file/{path...}", m.apiFileSave)
	mutating.HandleFunc("POST /api/file/{path...}", m.apiFileCreate)
	mutating.HandleFunc("DELETE /api/file/{path...}", m.apiFileDelete)
	mutating.HandleFunc("POST /api/move", m.apiMove)
	mutating.HandleFunc("POST /api/upload/{dir...}", m.apiUpload)
	mutating.HandleFunc("POST /api/preview", m.apiPreview)
	mutating.HandleFunc("POST /api/history/restore/{path...}", m.apiHistoryRestore)
	mutating.HandleFunc("POST /api/sync/check", m.apiSyncCheck)
	mutating.HandleFunc("POST /api/sync/reset", m.apiSyncReset)

	g.HandleFunc("GET /api/{path...}", func(w http.ResponseWriter, _ *http.Request) {
		jsonError(w, http.StatusNotFound, "not found")
	})
	g.HandleFunc("GET /{path...}", m.notFoundHandler)
}

func (wb *Web) staticHandler(files gzassets.Files) http.HandlerFunc {
	chroma := render.ChromaCSS()
	return func(w http.ResponseWriter, r *http.Request) {
		switch assetPath := r.PathValue("path"); assetPath {
		case "":
			http.NotFound(w, r)
		case "css/chroma.css":
			w.Header().Set("Content-Type", "text/css; charset=utf-8")
			http.ServeContent(w, r, "chroma.css", time.Time{}, bytes.NewReader(chroma))
		default:
			files.ServeFile(w, r, assetPath)
		}
	}
}

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
		Name:            wb.Title,
		ShortName:       wb.Title,
		StartURL:        "/",
		Scope:           "/",
		Display:         "standalone",
		ThemeColor:      theme.AutoTheme(theme.Light).BarColor(),
		BackgroundColor: theme.AutoTheme(theme.Light).BarColor(),
		Icons: []icon{
			{Src: iconURL(wb.Version, "icons/icon-192.png"), Sizes: "192x192", Type: "image/png", Purpose: "any"},
			{Src: iconURL(wb.Version, "icons/icon-512.png"), Sizes: "512x512", Type: "image/png", Purpose: "any"},
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

func pingHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if _, err := w.Write([]byte("pong")); err != nil {
		log.Printf("[DEBUG] write ping response: %v", err)
	}
}

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
	tmpl, err := template.ParseFS(templateFiles, "templates/*.html")
	if err != nil {
		return fmt.Errorf("parse templates: %w", err)
	}
	wb.templates = tmpl
	return nil
}

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

func failJSON(w http.ResponseWriter, r *http.Request, err error) {
	status := statusOf(err)
	logFailure(r, status, err)
	jsonError(w, status, errMessage(err))
}

func Favicon() []byte {
	data, err := assets.ReadFile("favicon.svg")
	if err != nil {
		panic("server: embedded favicon: " + err.Error())
	}
	return data
}

var iconStamp = sync.OnceValue(func() string {
	sum := sha256.Sum256(logoSVG())
	return hex.EncodeToString(sum[:4])
})

var logoSVG = sync.OnceValue(func() []byte {
	data, err := assets.ReadFile("logo.svg")
	if err != nil {
		panic("server: embedded logo: " + err.Error())
	}
	return data
})

func iconURL(version, name string) string {
	return "/static/" + version + "/" + name + "?v=" + iconStamp()
}

var loginLogo = sync.OnceValue(func() template.HTML {
	svg := strings.Replace(strings.TrimSpace(string(logoSVG())), "<svg ", `<svg class="login-logo" aria-hidden="true" `, 1)
	return template.HTML(svg) //nolint:gosec // the logo is a file of the binary and never input
})
