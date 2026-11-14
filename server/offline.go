package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/aleksey925/scrawl/plantuml"
	"github.com/aleksey925/scrawl/view"
)

const (
	offlineShellBase = "/static/offline/"
	workerAsset      = "sw/sw.js"
	iconsDir         = "icons"
)

type offlineApp struct {
	shell     []byte
	shellFile string
	script    []byte
}

type workerConfig struct {
	Build  string   `json:"build"`
	Shell  string   `json:"shell"`
	Assets []string `json:"assets"`
}

func (wb *Web) newOfflineApp() (*offlineApp, error) {
	shell, err := wb.renderShell(autoTheme(wb.Version), "")
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(shell)
	res := &offlineApp{shell: shell, shellFile: hex.EncodeToString(sum[:6]) + ".html"}

	shellURL := offlineShellBase + res.shellFile
	list, err := wb.offlineAssets(shellURL)
	if err != nil {
		return nil, err
	}
	worker, err := assets.ReadFile(workerAsset)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", workerAsset, err)
	}
	build := sha256.Sum256([]byte(wb.Version + "\n" + strings.Join(list, "\n") + "\n" + string(worker)))
	config, err := json.Marshal(workerConfig{Build: hex.EncodeToString(build[:6]), Shell: shellURL, Assets: list})
	if err != nil {
		return nil, fmt.Errorf("encode the worker config: %w", err)
	}
	res.script = slices.Concat([]byte("self.scrawlOffline = "), config, []byte(";\n"), worker)
	return res, nil
}

func (wb *Web) offlineAssets(shellURL string) ([]string, error) {
	app, err := assets.Names(appDir)
	if err != nil {
		return nil, fmt.Errorf("list the bundle: %w", err)
	}
	library, err := plantuml.LibraryFiles()
	if err != nil {
		return nil, fmt.Errorf("list the plantuml library: %w", err)
	}
	icons, err := assets.Names(iconsDir)
	if err != nil {
		return nil, fmt.Errorf("list the icons: %w", err)
	}

	res := make([]string, 0, len(app)+len(library)+len(icons)+3)
	for _, name := range app {
		if appDir+"/"+name == appManifest || name == "index.html" {
			continue
		}
		res = append(res, wb.appShell.base()+name)
	}
	for _, name := range library {
		res = append(res, "/static/"+wb.appShell.version+"/"+plantuml.LibraryDir+"/"+name)
	}
	res = append(res, "/static/"+wb.Version+"/css/chroma.css", iconURL(wb.Version, "favicon.svg"))
	for _, name := range icons {
		res = append(res, iconURL(wb.Version, iconsDir+"/"+name))
	}
	return append(res, shellURL), nil
}

func (wb *Web) workerHandler(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Content-Type", "text/javascript; charset=utf-8")
	h.Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, "sw.js", time.Time{}, bytes.NewReader(wb.offline.script))
}

func (wb *Web) offlineShellHandler(w http.ResponseWriter, r *http.Request) {
	if r.PathValue("file") != wb.offline.shellFile {
		w.Header().Set("Cache-Control", "no-store")
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", appCacheControl)
	if _, err := w.Write(wb.offline.shell); err != nil {
		log.Printf("[DEBUG] write the offline shell: %v", err)
	}
}

func (m *mount) apiVersions(w http.ResponseWriter, r *http.Request) {
	root, err := m.spc.Store.Tree()
	if err != nil {
		logFailure(r, http.StatusInternalServerError, err)
		jsonError(w, http.StatusInternalServerError, "the list of files could not be built")
		return
	}
	body, err := json.Marshal(view.Versions(root, m.Version))
	if err != nil {
		logFailure(r, http.StatusInternalServerError, err)
		jsonError(w, http.StatusInternalServerError, "the list of files could not be built")
		return
	}
	sum := sha256.Sum256(body)
	etag := strconv.Quote(hex.EncodeToString(sum[:8]))
	h := w.Header()
	h.Set("ETag", etag)
	h.Set("Cache-Control", pageCacheControl)
	if matchesETag(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	h.Set("Content-Type", "application/json; charset=utf-8")
	if _, err := w.Write(body); err != nil {
		log.Printf("[DEBUG] write versions response: %v", err)
	}
}
