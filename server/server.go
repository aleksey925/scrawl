// Package server implements the HTTP layer of mdserver: the http.Server
// lifecycle, routing, the middleware stack and the embedded templates and
// static assets.
package server

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"time"

	"github.com/go-pkgz/lgr"
	"github.com/go-pkgz/rest"
	"github.com/go-pkgz/rest/logger"
	"github.com/go-pkgz/routegroup"
)

//go:embed templates assets
var content embed.FS

const (
	throttleLimit          = 1000
	staticCacheTTL         = 365 * 24 * time.Hour
	defaultShutdownTimeout = 5 * time.Second
)

// Config holds every knob the web layer needs. main maps its options onto it
// field by field, no other package reads the command line.
type Config struct {
	ListenAddr   string // address to listen on, host:port
	RootDir      string // absolute path of the knowledge base root
	Title        string // site title shown in the UI
	Version      string // build revision, also the static assets cache buster
	ReadOnly     bool   // refuse every write endpoint
	TrustedProxy bool   // trust X-Forwarded-For and X-Forwarded-Proto
	MaxUpload    int64  // upload size cap in bytes
	AuthDisabled bool   // serve without authentication

	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	ShutdownTimeout   time.Duration
}

// Web is the http server of mdserver, built as a struct literal in main.
type Web struct {
	Config
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

func (wb *Web) router() (http.Handler, error) {
	assetsFS, err := fs.Sub(content, "assets")
	if err != nil {
		return nil, fmt.Errorf("sub fs for assets: %w", err)
	}

	router := routegroup.New(http.NewServeMux())
	router.Use(rest.Trace, rest.RealIP, rest.Recoverer(lgr.Default()))
	router.Use(rest.Throttle(throttleLimit))
	router.Use(logger.New(logger.Log(lgr.Default()), logger.Prefix("[DEBUG]")).Handler)
	router.Use(rest.AppInfo("mdserver", "aleksey925", wb.Version), rest.Ping)

	// the version segment is part of the URL only to bust the cache, lookup
	// ignores it so that an old page keeps working after a redeploy
	router.With(rest.CacheControl(staticCacheTTL, wb.Version)).
		HandleFunc("GET /static/{version}/{path...}", func(w http.ResponseWriter, r *http.Request) {
			assetPath := r.PathValue("path")
			if assetPath == "" {
				http.NotFound(w, r)
				return
			}
			http.ServeFileFS(w, r, assetsFS, assetPath)
		})

	// TODO(agent): page, raw, edit, search and login routes go here
	// TODO(agent): /api group with tree, file CRUD, move, upload, preview, search
	// TODO(agent): auth and CSRF middleware around the write endpoints
	// TODO(agent): template parsing and rendering helpers

	return router, nil
}
