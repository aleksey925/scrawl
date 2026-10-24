package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"slices"

	"github.com/aleksey925/scrawl/gzassets"
	"github.com/aleksey925/scrawl/store"
)

// appDir is where the bundle sits among the embedded assets, and the last
// segment of the address it is served under.
const appDir = "app"

// appManifest is the name vite is configured to write. go:embed on a directory
// skips dot-prefixed entries, so vite's default .vite/manifest.json would embed
// the bundle without the index that names its entry.
const appManifest = appDir + "/manifest.json"

// appThemes is the stylesheet of the themes vite writes beside the bundle,
// which the sign-in page links.
const appThemes = "themes.css"

// appCacheControl lets a browser keep a file of the bundle for a year without
// asking again: its address changes whenever its content may have.
const appCacheControl = "max-age=31536000, immutable"

// appBase is the address the bundle is served under. The version is a digest
// of the bundle, so the names in it carry no hash and stay the same in git,
// and vite builds with a relative base, so every chunk a page imports later
// is asked for under the version the page started with.
func appBase(version string) string {
	return "/static/" + version + "/" + appDir + "/"
}

// manifestChunk is the part of vite's build manifest the shell reads.
type manifestChunk struct {
	File    string   `json:"file"`
	IsEntry bool     `json:"isEntry"`
	CSS     []string `json:"css"`
	Imports []string `json:"imports"`
}

// appShell renders the single page app's document. The asset names are read
// from the manifest once at startup rather than written into a template by
// hand, and put under the address of this bundle's version.
type appShell struct {
	tmpl *template.Template
	// version is the digest of the bundle
	version string
	entry   string
	css     []string
	preload []string
}

func (s *appShell) base() string {
	return appBase(s.version)
}

type shellData struct {
	Title   string
	Theme   pageTheme
	Version string
	Favicon string
	Base    string
	Entry   string
	CSS     []string
	Preload []string
}

// shellTemplate is the document the app boots from. It carries no inline script:
// the theme and its scheme are attributes the server resolves from the cookie,
// which is what keeps script-src at 'self' with nothing to nonce.
const shellTemplate = `<!doctype html>
<html lang="en"{{with .Theme.ID}} data-scrawl-theme="{{.}}" data-mantine-color-scheme="{{$.Theme.Scheme}}"{{end}}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="color-scheme" content="light dark">
{{range .Theme.BarColors}}<meta name="theme-color" content="{{.Color}}"{{with .Media}} media="{{.}}"{{end}}>
{{end}}<title>{{.Title}}</title>
<link rel="icon" href="{{.Favicon}}" type="image/svg+xml">
{{range .Theme.TouchIcons}}<link rel="apple-touch-icon" href="{{.Href}}"{{with .Media}} media="{{.}}"{{end}}>
{{end}}
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
func newAppShell(files gzassets.Files) (*appShell, error) {
	raw, err := files.ReadFile(appManifest)
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

	version, err := files.Digest(appDir)
	if err != nil {
		return nil, fmt.Errorf("digest the bundle: %w", err)
	}
	base := appBase(version)
	shell := &appShell{tmpl: tmpl, version: version, entry: base + entry.File}
	for _, href := range shellCSS(chunks, entry) {
		shell.css = append(shell.css, base+href)
	}
	for _, name := range entry.Imports {
		if chunk, ok := chunks[name]; ok {
			shell.preload = append(shell.preload, base+chunk.File)
		}
	}
	return shell, nil
}

// shellCSS is the entry's stylesheets and then those of every chunk it imports,
// which vite links from no page of ours. They follow the entry's, where
// mantine's sheet is, because the chrome's controls override it at equal
// specificity.
func shellCSS(chunks map[string]manifestChunk, entry manifestChunk) []string {
	css := slices.Clone(entry.CSS)
	seen := map[string]bool{}
	var walk func(imports []string)
	walk = func(imports []string) {
		for _, name := range imports {
			chunk, ok := chunks[name]
			if !ok || seen[name] {
				continue
			}
			seen[name] = true
			walk(chunk.Imports)
			for _, href := range chunk.CSS {
				if !slices.Contains(css, href) {
					css = append(css, href)
				}
			}
		}
	}
	walk(entry.Imports)
	return css
}

// appAssetHandler serves a file of the bundle under this binary's version
// only. The names carry no hash, so a page left open from an older release
// must fail to load a chunk and reload, rather than get this release's chunk
// under the name of its own.
func (wb *Web) appAssetHandler(files gzassets.Files) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := appDir + "/" + r.PathValue("path")
		if r.PathValue("version") != wb.appShell.version || !files.Has(name) {
			w.Header().Set("Cache-Control", "no-store")
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", appCacheControl)
		files.ServeFile(w, r, name)
	}
}

// appHandler answers a page route with the shell and lets the client router
// decide what it is. It is behind the auth middleware like any other page, so
// an anonymous visitor is redirected to the login page instead.
func (m *mount) appHandler(w http.ResponseWriter, r *http.Request) {
	m.serveShell(w, r, http.StatusOK)
}

// notFoundHandler answers a path inside this space that no route claimed. The
// status says the name holds nothing, and the body is still the app, so the
// reader gets the empty state with the navigation around it rather than a bare
// line of text.
func (m *mount) notFoundHandler(w http.ResponseWriter, r *http.Request) {
	m.serveShell(w, r, http.StatusNotFound)
}

// plainNotFound answers a path that belongs to no space: an unknown space
// name, or a stray path at the root. It cannot serve the shell, because the
// base the client needs is a space's prefix and there is no space here.
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

	// a missing name answers 404 whatever its extension, or
	// /doc/<anything>/ping would look like a route that exists
	if _, err := m.spc.Store.Stat(p); errors.Is(err, store.ErrNotFound) {
		m.serveShell(w, r, http.StatusNotFound)
		return
	}
	m.serveShell(w, r, http.StatusOK)
}

func (m *mount) serveShell(w http.ResponseWriter, r *http.Request, status int) {
	data := shellData{
		Title:   m.Title,
		Theme:   themeOf(r, m.Version),
		Version: m.Version,
		Favicon: iconURL(m.Version, "favicon.svg"),
		Base:    m.spc.Prefix(),
		Entry:   m.appShell.entry,
		CSS:     m.appShell.css,
		Preload: m.appShell.preload,
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
