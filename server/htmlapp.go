package server

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"log"
	"net"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-pkgz/lgr"
	"github.com/go-pkgz/rest"
	"github.com/go-pkgz/rest/logger"

	"github.com/aleksey925/scrawl/auth"
	"github.com/aleksey925/scrawl/htmlapp"
	"github.com/aleksey925/scrawl/store"
)

const (
	appsBase       = "/__scrawl"
	appsEnter      = appsBase + "/enter"
	appsEnterJS    = appsBase + "/enter.js"
	appsWorker     = appsBase + "/sw.js"
	appsFiles      = appsBase + "/files"
	appsAssetDir   = "htmlapp"
	ticketTTL      = 60 * time.Second
	ticketNonceLen = 16
	maxRunBody     = 1 << 10

	appsExpired  = "This link has expired. Open the app from scrawl again."
	appsNoCookie = "Open this app from scrawl. If you just did, this browser did not keep " +
		"the app's cookie inside the frame: open it in a new tab."
	appsNotHere = "HTML apps do not run at this address. On this machine, open scrawl at %s, " +
		"the link it prints at start. From a phone or another device, open scrawl over https with APPS_URL set."
	appsSameHost    = "HTML apps cannot run on the address of scrawl itself. Set APPS_URL to a name of its own."
	appsNeedBrowser = "HTML apps open only in a browser"
	appsNotAnApp    = "only an .html file runs as an app"
	enterTemplate   = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>scrawl</title>
</head>
<body data-file="{{.File}}" data-parent="{{.Parent}}" data-offline="{{.Offline}}">
<script src="` + appsEnterJS + `"></script>
</body>
</html>
`
)

var enterPage = template.Must(template.New("enter").Parse(enterTemplate))

type usedNonces struct {
	mu    sync.Mutex
	taken map[string]time.Time
}

func newUsedNonces() *usedNonces { return &usedNonces{taken: map[string]time.Time{}} }

func (u *usedNonces) take(nonce string, expiry, now time.Time) bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	if _, ok := u.taken[nonce]; ok {
		return false
	}
	for key, at := range u.taken {
		if !at.After(now) {
			delete(u.taken, key)
		}
	}
	u.taken[nonce] = expiry
	return true
}

func (wb *Web) withApps(scrawl http.Handler) http.Handler {
	if wb.Auth == nil {
		return scrawl
	}
	wb.appNonces = newUsedNonces()
	stack := []func(http.Handler) http.Handler{
		rest.Trace, rest.Recoverer(lgr.Default()), appsHeaders, appName, rest.Gzip(gzipContentTypes...),
	}
	if wb.TrustedProxy {
		stack = append(stack, rest.RealIP)
	}
	stack = append(stack, rest.Throttle(throttleLimit),
		logger.New(logger.Log(lgr.Default()), logger.Prefix("[DEBUG]")).Handler)
	apps := rest.Wrap(http.HandlerFunc(wb.appsHandler), stack...)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := wb.Apps.Match(r.Host); ok {
			apps.ServeHTTP(w, r)
			return
		}
		scrawl.ServeHTTP(w, r)
	})
}

func appsHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		next.ServeHTTP(w, r)
	})
}

func (wb *Web) appsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, statusMessage(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}
	id, _ := wb.Apps.Match(r.Host)
	if id == "" {
		http.Error(w, statusMessage(http.StatusNotFound), http.StatusNotFound)
		return
	}
	switch r.URL.Path {
	case appsEnter:
		wb.appsEnter(w, r)
	case appsEnterJS:
		appsScript(w, r, "enter.js")
	case appsWorker:
		w.Header().Set("Service-Worker-Allowed", "/")
		appsScript(w, r, "sw.js")
	case appsFiles:
		wb.appsFileList(w, r, id)
	default:
		wb.appsFile(w, r, id)
	}
}

func appsScript(w http.ResponseWriter, r *http.Request, name string) {
	h := w.Header()
	h.Set("Content-Type", "text/javascript; charset=utf-8")
	h.Set("Cache-Control", "no-cache")
	assets.ServeFile(w, r, appsAssetDir+"/"+name)
}

func (wb *Web) appsEnter(w http.ResponseWriter, r *http.Request) {
	user, raw, ok := wb.Auth.Unseal(htmlapp.TicketPurpose, r.URL.Query().Get("t"))
	var ticket htmlapp.Ticket
	if ok && json.Unmarshal(raw, &ticket) != nil {
		ok = false
	}
	if !ok || !sameHostname(ticket.App, r.Host) ||
		!wb.appNonces.take(ticket.Nonce, time.Now().Add(ticketTTL), time.Now()) {
		http.Error(w, appsExpired, http.StatusUnauthorized)
		return
	}
	if _, found := wb.byName[ticket.Space]; !found {
		http.Error(w, statusMessage(http.StatusNotFound), http.StatusNotFound)
		return
	}

	value, err := json.Marshal(htmlapp.Cookie{Space: ticket.Space, Folder: ticket.Folder, Parent: ticket.Parent})
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	ttl := wb.Auth.TTL()
	cookie := &http.Cookie{
		Name:     wb.Apps.CookieName(),
		Value:    wb.Auth.Seal(htmlapp.CookiePurpose, user, value, time.Now().Add(ttl)),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   strings.HasPrefix(ticket.App, "https://"),
		MaxAge:   int(ttl / time.Second),
	}
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" && r.Header.Get("Sec-Fetch-Dest") == "iframe" {
		cookie.SameSite, cookie.Secure, cookie.Partitioned = http.SameSiteNoneMode, true, true
		ticket.Offline = false
	}
	http.SetCookie(w, cookie)

	h := w.Header()
	h.Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; frame-ancestors "+ticket.Parent)
	h.Set("Cache-Control", "no-store")
	h.Set("Content-Type", "text/html; charset=utf-8")
	data := struct {
		File    string
		Parent  string
		Offline bool
	}{File: "/" + url.PathEscape(ticket.File), Parent: ticket.Parent, Offline: ticket.Offline}
	if err := enterPage.Execute(w, data); err != nil {
		log.Printf("[DEBUG] write the enter page: %v", err)
	}
}

func sameHostname(origin, host string) bool {
	u, err := url.Parse(origin)
	return err == nil && u.Host != "" && htmlapp.Hostname(u.Host) == htmlapp.Hostname(host)
}

func (wb *Web) appCookie(r *http.Request, id string) (*Space, htmlapp.Cookie, bool) {
	cookie, err := r.Cookie(wb.Apps.CookieName())
	if err != nil {
		return nil, htmlapp.Cookie{}, false
	}
	_, raw, ok := wb.Auth.Unseal(htmlapp.CookiePurpose, cookie.Value)
	var res htmlapp.Cookie
	if !ok || json.Unmarshal(raw, &res) != nil || htmlapp.ID(res.Space, res.Folder) != id {
		return nil, htmlapp.Cookie{}, false
	}
	spc, found := wb.byName[res.Space]
	return spc, res, found
}

func (wb *Web) appsFile(w http.ResponseWriter, r *http.Request, id string) {
	spc, cookie, ok := wb.appCookie(r, id)
	if !ok {
		http.Error(w, appsNoCookie, http.StatusUnauthorized)
		return
	}
	h := w.Header()
	h.Set("Content-Security-Policy", "frame-ancestors "+cookie.Parent)

	clean := path.Clean("/" + r.URL.Path)
	if clean == appsBase || strings.HasPrefix(clean, appsBase+"/") {
		http.Error(w, statusMessage(http.StatusNotFound), http.StatusNotFound)
		return
	}
	target := path.Join(cookie.Folder, strings.TrimPrefix(clean, "/"))
	if strings.HasSuffix(r.URL.Path, "/") {
		target = path.Join(target, "index.html")
	} else if fi, err := spc.Store.Stat(target); err == nil && fi.IsDir {
		location := r.URL.EscapedPath() + "/"
		if r.URL.RawQuery != "" {
			location += "?" + r.URL.RawQuery
		}
		http.Redirect(w, r, location, http.StatusMovedPermanently)
		return
	}
	contentType, known := htmlapp.ContentType(target)
	if !known {
		http.Error(w, statusMessage(http.StatusNotFound), http.StatusNotFound)
		return
	}
	f, fi, err := spc.Store.Open(target)
	if err != nil {
		status := statusOf(err)
		logFailure(r, status, err)
		http.Error(w, statusMessage(status), status)
		return
	}
	defer f.Close()
	h.Set("Content-Type", contentType)
	h.Set("Cache-Control", "private, no-cache")
	h.Set("ETag", rawETag(fi))
	http.ServeContent(w, r, fi.Name, fi.ModTime, f)
}

type appsFileEntry struct {
	Path string `json:"path"`
	ETag string `json:"etag"`
}

func (wb *Web) appsFileList(w http.ResponseWriter, r *http.Request, id string) {
	spc, cookie, ok := wb.appCookie(r, id)
	if !ok {
		http.Error(w, appsNoCookie, http.StatusUnauthorized)
		return
	}
	root, err := spc.Store.Tree()
	if err != nil {
		logFailure(r, http.StatusInternalServerError, err)
		http.Error(w, "the list of files could not be built", http.StatusInternalServerError)
		return
	}
	files := []appsFileEntry{}
	if folder := findFolder(root, cookie.Folder); folder != nil {
		files = appWebFiles(folder, cookie.Folder, files)
	}
	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, http.StatusOK, map[string][]appsFileEntry{"files": files})
}

func findFolder(root *store.Node, folder string) *store.Node {
	node := root
	if folder == "" {
		return node
	}
	for name := range strings.SplitSeq(folder, "/") {
		var next *store.Node
		for _, child := range node.Children {
			if child.IsDir && child.Name == name {
				next = child
				break
			}
		}
		if next == nil {
			return nil
		}
		node = next
	}
	return node
}

func appWebFiles(node *store.Node, folder string, into []appsFileEntry) []appsFileEntry {
	for _, child := range node.Children {
		if child.IsDir {
			into = appWebFiles(child, folder, into)
			continue
		}
		if _, ok := htmlapp.ContentType(child.Name); !ok {
			continue
		}
		rel := child.Path
		if folder != "" {
			rel = strings.TrimPrefix(child.Path, folder+"/")
		}
		if strings.HasPrefix("/"+rel, appsBase+"/") {
			continue
		}
		into = append(into, appsFileEntry{Path: rel, ETag: rawETag(child.FileInfo)})
	}
	return into
}

func (m *mount) apiRun(w http.ResponseWriter, r *http.Request) {
	if auth.ByToken(r) {
		jsonError(w, http.StatusForbidden, appsNeedBrowser)
		return
	}
	p, ok := contentPath(r, "path")
	if !ok || p == "" {
		jsonError(w, http.StatusBadRequest, statusMessage(http.StatusBadRequest))
		return
	}
	fi, err := m.spc.Store.Stat(p)
	if err != nil {
		failJSON(w, r, err)
		return
	}
	if fi.IsDir || !htmlapp.Runnable(fi.Path) {
		jsonError(w, http.StatusBadRequest, appsNotAnApp)
		return
	}
	parent, ok := parentOrigin(r)
	if !ok {
		jsonError(w, http.StatusForbidden, "cross-origin request blocked")
		return
	}
	var req struct {
		Offline bool `json:"offline"`
	}
	if !decodeJSON(w, r, &req, maxRunBody) {
		return
	}

	folder := htmlapp.Folder(fi.Path)
	origin, err := m.Apps.Origin(htmlapp.ID(m.spc.Name, folder), parent)
	switch {
	case errors.Is(err, htmlapp.ErrNotHere):
		jsonError(w, http.StatusConflict, notHereMessage(r.Host))
		return
	case err != nil:
		jsonError(w, http.StatusConflict, appsSameHost)
		return
	}

	user, _ := m.Auth.User(r)
	nonce := make([]byte, ticketNonceLen)
	_, _ = rand.Read(nonce)
	ticket, err := json.Marshal(htmlapp.Ticket{
		Space:   m.spc.Name,
		Folder:  folder,
		File:    fi.Name,
		Parent:  parent,
		App:     origin,
		Nonce:   base64.RawURLEncoding.EncodeToString(nonce),
		Offline: req.Offline,
	})
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "internal error")
		return
	}
	sealed := m.Auth.Seal(htmlapp.TicketPurpose, user, ticket, time.Now().Add(ticketTTL))
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{
		"url": origin + appsEnter + "?t=" + url.QueryEscape(sealed),
		"app": origin + "/" + url.PathEscape(fi.Name),
	})
}

func notHereMessage(host string) string {
	link := "http://127.0.0.1"
	if _, port, err := net.SplitHostPort(host); err == nil {
		link += ":" + port
	}
	return fmt.Sprintf(appsNotHere, link)
}

func parentOrigin(r *http.Request) (string, bool) {
	u, err := url.Parse(r.Header.Get("Origin"))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.Opaque != "" ||
		u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.Host == "" {
		return "", false
	}
	if port := u.Port(); port != "" {
		if _, err := strconv.ParseUint(port, 10, 16); err != nil {
			return "", false
		}
	}
	if hostname := u.Hostname(); net.ParseIP(hostname) == nil && !hostnameChars(hostname) {
		return "", false
	}
	if !strings.EqualFold(u.Host, r.Host) {
		return "", false
	}
	return u.Scheme + "://" + strings.ToLower(u.Host), true
}

func hostnameChars(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '.' && c != '-' {
			return false
		}
	}
	return true
}
