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

const (
	appDir      = "app"
	plantumlDir = "plantuml"
)

const appManifest = appDir + "/manifest.json"

const appThemes = "themes.css"

const appCacheControl = "max-age=31536000, immutable"

func appBase(version string) string {
	return "/static/" + version + "/" + appDir + "/"
}

type manifestChunk struct {
	File    string   `json:"file"`
	IsEntry bool     `json:"isEntry"`
	CSS     []string `json:"css"`
	Imports []string `json:"imports"`
}

type appShell struct {
	tmpl    *template.Template
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

func (m *mount) appHandler(w http.ResponseWriter, r *http.Request) {
	m.serveShell(w, r, http.StatusOK)
}

func (m *mount) notFoundHandler(w http.ResponseWriter, r *http.Request) {
	m.serveShell(w, r, http.StatusNotFound)
}

func plainNotFound(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, statusMessage(http.StatusNotFound), http.StatusNotFound)
}

func (m *mount) docHandler(w http.ResponseWriter, r *http.Request) {
	p, ok := contentPath(r, "path")
	if !ok || p == "" {
		m.serveShell(w, r, http.StatusOK)
		return
	}

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
