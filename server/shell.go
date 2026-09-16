package server

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"log"
	"net/http"

	"github.com/aleksey925/scrawl/store"
)

// appBase is the url prefix the bundle was built with. Vite bakes it into every
// dynamic import it emits, so the shell has to name the same one. The static
// route ignores the version segment on lookup, which is why a fixed literal
// stands where the build cannot know the revision.
const appBase = "/static/spa/app/"

// appManifest is the name vite is configured to write. go:embed on a directory
// skips dot-prefixed entries, so vite's default .vite/manifest.json would embed
// the bundle without the index that names its entry.
const appManifest = "app/manifest.json"

const nonceBytes = 16

// nonceKey carries the per-response style nonce from the security middleware to
// the shell, which is the only thing that renders it.
type nonceKey struct{}

func withNonce(ctx context.Context, nonce string) context.Context {
	return context.WithValue(ctx, nonceKey{}, nonce)
}

func nonceOf(ctx context.Context) string {
	nonce, _ := ctx.Value(nonceKey{}).(string)
	return nonce
}

// newNonce mints the per-response style nonce. The encoding is the url safe
// alphabet because the standard one carries '+', which html/template escapes to
// &#43; inside the meta attribute: the browser decodes it back, but the header
// and the document would then show two different strings to anyone reading a
// violation report.
func newNonce() (string, error) {
	buf := make([]byte, nonceBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// manifestChunk is the part of vite's build manifest the shell reads.
type manifestChunk struct {
	File    string   `json:"file"`
	IsEntry bool     `json:"isEntry"`
	CSS     []string `json:"css"`
	Imports []string `json:"imports"`
}

// appShell renders the single page app's document. The asset names are content
// hashed and change on every build, so they are read from the manifest once at
// startup rather than written into a template by hand.
type appShell struct {
	tmpl    *template.Template
	entry   string
	css     []string
	preload []string
}

type shellData struct {
	Title       string
	ColorScheme string
	Nonce       string
	Version     string
	Base        string
	Entry       string
	CSS         []string
	Preload     []string
}

// shellTemplate is the document the app boots from. It carries no inline script:
// the color scheme is an attribute the server resolves from the cookie, which
// is what keeps script-src at 'self' with nothing to nonce.
const shellTemplate = `<!doctype html>
<html lang="en"{{if .ColorScheme}} data-mantine-color-scheme="{{.ColorScheme}}"{{end}}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="color-scheme" content="light dark">
<meta name="csp-nonce" content="{{.Nonce}}">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1c1c1e" media="(prefers-color-scheme: dark)">
<title>{{.Title}}</title>
<link rel="icon" href="/static/{{.Version}}/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/static/{{.Version}}/icons/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="{{.Title}}">
{{/* render generates the highlighting stylesheet from the chroma style at
     runtime, so it is not a file vite could bundle. It comes first, which
     leaves the bundle free to override a token color. */}}
<link rel="stylesheet" href="/static/{{.Version}}/css/chroma.css">
{{range .CSS}}<link rel="stylesheet" crossorigin href="{{.}}">
{{end}}{{range .Preload}}<link rel="modulepreload" crossorigin href="{{.}}">
{{end}}<script type="module" crossorigin src="{{.Entry}}"></script>
</head>
<body>
<div id="scrawl-app-root" data-base="{{.Base}}"></div>
</body>
</html>
`

// newAppShell reads the vite manifest and resolves the entry chunk, its
// stylesheets and the chunks worth preloading.
func newAppShell(assetsFS fs.FS) (*appShell, error) {
	raw, err := fs.ReadFile(assetsFS, appManifest)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", appManifest, err)
	}

	var chunks map[string]manifestChunk
	if err = json.Unmarshal(raw, &chunks); err != nil {
		return nil, fmt.Errorf("parse %s: %w", appManifest, err)
	}

	var entry manifestChunk
	var found bool
	for _, chunk := range chunks {
		if chunk.IsEntry {
			entry, found = chunk, true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("%s names no entry chunk", appManifest)
	}

	tmpl, err := template.New("shell").Parse(shellTemplate)
	if err != nil {
		return nil, fmt.Errorf("parse shell template: %w", err)
	}

	shell := &appShell{tmpl: tmpl, entry: appBase + entry.File}
	for _, href := range entry.CSS {
		shell.css = append(shell.css, appBase+href)
	}
	for _, name := range entry.Imports {
		if chunk, ok := chunks[name]; ok {
			shell.preload = append(shell.preload, appBase+chunk.File)
		}
	}
	return shell, nil
}

// appHandler answers a page route with the shell and lets the client router
// decide what it is. It is behind the auth middleware like any other page, so
// an anonymous visitor is redirected to the login page instead.
func (m *mount) appHandler(w http.ResponseWriter, r *http.Request) {
	m.serveShell(w, r, http.StatusOK)
}

// notFoundHandler answers a path inside this project that no route claimed. The
// status says the name holds nothing, and the body is still the app, so the
// reader gets the empty state with the navigation around it rather than a bare
// line of text.
func (m *mount) notFoundHandler(w http.ResponseWriter, r *http.Request) {
	m.serveShell(w, r, http.StatusNotFound)
}

// plainNotFound answers a path that belongs to no project: an unknown project
// name, or a stray path at the root. It cannot serve the shell, because the
// base the client needs is a project's prefix and there is no project here.
func plainNotFound(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, statusMessage(http.StatusNotFound), http.StatusNotFound)
}

// docHandler answers <prefix>/doc/. It is the one page route whose status is not
// always 200: a link to a note that is not there answers 404 the way the server
// rendered page did, because a crawler, a link checker and `curl -f` all read
// the status and none of them run the client router. The body is the shell
// either way, so the app still offers to create it.
//
// Only reading is judged. /edit/ of a missing note is how one is created.
func (m *mount) docHandler(w http.ResponseWriter, r *http.Request) {
	p, ok := contentPath(r, "path")
	if !ok || p == "" {
		m.serveShell(w, r, http.StatusOK)
		return
	}

	fi, err := m.prj.Store.Stat(p)
	switch {
	case errors.Is(err, store.ErrNotFound):
		// nothing of that name is there, whatever the extension says. Answering
		// 200 would make /doc/<anything>/ping look like a route that exists.
		m.serveShell(w, r, http.StatusNotFound)
		return
	case err == nil && !fi.IsDir && !isMarkdown(p):
		// an attachment is not a page: it goes to the route that serves a file
		// under a content type from an allowlist, with a policy of its own. A
		// directory is not markdown either, and it is a page.
		http.Redirect(w, r, m.prj.Prefix()+"/raw/"+encodePath(p), http.StatusFound)
		return
	}
	m.serveShell(w, r, http.StatusOK)
}

func (m *mount) serveShell(w http.ResponseWriter, r *http.Request, status int) {
	theme := themeOf(r)
	data := shellData{
		Title:   m.Title,
		Nonce:   nonceOf(r.Context()),
		Version: m.Version,
		Base:    m.prj.Prefix(),
		Entry:   m.appShell.entry,
		CSS:     m.appShell.css,
		Preload: m.appShell.preload,
	}
	// auto is left for the client: the system preference is not something a
	// request carries, and guessing it here is the flash this attribute exists
	// to prevent
	if theme == "light" || theme == "dark" {
		data.ColorScheme = theme
	}

	var buf bytes.Buffer
	if err := m.appShell.tmpl.Execute(&buf, data); err != nil {
		log.Printf("[ERROR] render app shell: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if _, err := buf.WriteTo(w); err != nil {
		log.Printf("[DEBUG] write app shell: %v", err)
	}
}
