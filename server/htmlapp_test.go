package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/htmlapp"
)

const (
	scrawlHost    = "127.0.0.1:7272"
	scrawlOrigin  = "http://" + scrawlHost
	counterFolder = "apps/counter"
	counterFile   = counterFolder + "/index.html"
	otherFile     = "apps/other/index.html"
)

var counterFiles = map[string]string{
	"index.html":        "<p>counter</p>",
	"page2.html":        "<p>page 2</p>",
	"style.css":         "p{}",
	"app.js":            "console.log(1)",
	"app.mjs":           "export {}",
	"app.wasm":          "\x00asm",
	"logo.svg":          "<svg/>",
	"notes.md":          "# notes",
	"run.sh":            "echo",
	".secret.js":        "secret",
	"node_modules/x.js": "excluded",
	"sub/index.html":    "<p>sub</p>",
	"sw.js":             "self.oninstall = null",
	"api/data.json":     "{}",
	"static/app.js":     "static",
	"__scrawl/sw.js":    "not scrawl's",
}

func seedApps(t *testing.T, root string) {
	t.Helper()
	files := map[string]string{
		otherFile:     "<p>other</p>",
		"root.html":   "<p>root</p>",
		"upper.HTM":   "<p>upper</p>",
		"secret.js":   "outside",
		".git/config": "[core]",
	}
	for name, data := range counterFiles {
		files[counterFolder+"/"+name] = data
	}
	for name, data := range files {
		full := filepath.Join(root, filepath.FromSlash(name))
		require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o750))
		require.NoError(t, os.WriteFile(full, []byte(data), 0o600))
	}
	require.NoError(t, os.Symlink(filepath.Join(root, "secret.js"), filepath.Join(root, counterFolder, "link.js")))
}

func newAppsServer(t *testing.T, opts testOpts) *testServer {
	t.Helper()
	opts.prepare = func(root string) { seedApps(t, root) }
	return newTestServer(t, opts)
}

func (ts *testServer) serve(r *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	ts.handler.ServeHTTP(rec, r)
	return rec
}

func (ts *testServer) addSession(t *testing.T, r *http.Request) {
	t.Helper()
	rec := httptest.NewRecorder()
	require.NoError(t, ts.Auth.SetCookie(rec, r, testUser))
	for _, cookie := range rec.Result().Cookies() {
		r.AddCookie(cookie)
	}
}

func (ts *testServer) runRequest(t *testing.T, origin, file string, offline bool) *http.Request {
	t.Helper()
	body := fmt.Sprintf(`{"offline":%t}`, offline)
	r := httptest.NewRequest(http.MethodPost, origin+ts.prefix()+"/api/run/"+file, strings.NewReader(body))
	r.Header.Set("Origin", origin)
	r.Header.Set("Sec-Fetch-Site", "same-origin")
	r.Header.Set("Content-Type", "application/json")
	if strings.HasPrefix(origin, "https://") {
		r.Header.Set("X-Forwarded-Proto", "https")
	}
	ts.addSession(t, r)
	return r
}

type runAnswer struct {
	URL   string `json:"url"`
	App   string `json:"app"`
	Error string `json:"error"`
}

func (ts *testServer) run(t *testing.T, origin, file string, offline bool) runAnswer {
	t.Helper()
	rec := ts.serve(ts.runRequest(t, origin, file, offline))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var res runAnswer
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &res))
	return res
}

func (ts *testServer) enter(ticketURL, fetchSite string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, ticketURL, http.NoBody)
	if fetchSite != "" {
		r.Header.Set("Sec-Fetch-Site", fetchSite)
	}
	return ts.serve(r)
}

func (ts *testServer) appCookie(t *testing.T, file string) (string, *http.Cookie) {
	t.Helper()
	ticket := ts.run(t, scrawlOrigin, file, false)
	rec := ts.enter(ticket.URL, "cross-site")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	cookies := rec.Result().Cookies()
	require.Len(t, cookies, 1)
	u, err := url.Parse(ticket.URL)
	require.NoError(t, err)
	return u.Host, cookies[0]
}

func appGet(host, target string, cookie *http.Cookie) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "http://"+host+target, http.NoBody)
	if cookie != nil {
		r.AddCookie(cookie)
	}
	return r
}

func appHost(file string) string {
	return "app-" + htmlapp.ID(testSpace, htmlapp.Folder(file)) + ".localhost:7272"
}

func TestAppsHostServesNoScrawlHandler(t *testing.T) {
	// arrange
	ts := newAppsServer(t, testOpts{withAuth: true})
	host, cookie := ts.appCookie(t, otherFile)
	paths := []string{"/login", "/static/x.js", "/api/spaces", "/ping", "/sw.js", "/s/" + testSpace + "/"}

	for _, target := range paths {
		t.Run(target, func(t *testing.T) {
			// act
			rec := ts.serve(appGet(host, target, cookie))

			// assert
			assert.Equal(t, http.StatusNotFound, rec.Code)
			assert.Equal(t, "frame-ancestors "+scrawlOrigin, rec.Header().Get("Content-Security-Policy"))
			assert.Empty(t, rec.Header().Get("X-Frame-Options"))
			assert.Empty(t, rec.Header().Get("Service-Worker-Allowed"))
			assert.Equal(t, "scrawl", rec.Header().Get("App-Name"))
			assert.Equal(t, "same-origin", rec.Header().Get("Cross-Origin-Resource-Policy"))
			assert.Equal(t, "no-referrer", rec.Header().Get("Referrer-Policy"))
			assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
		})
	}
}

func TestAppsHostServesTheFilesOfAppsNamedAsScrawlRoutes(t *testing.T) {
	// arrange
	ts := newAppsServer(t, testOpts{withAuth: true})
	host, cookie := ts.appCookie(t, counterFile)
	tests := []struct {
		target string
		file   string
		ct     string
	}{
		{target: "/sw.js", file: "sw.js", ct: "text/javascript; charset=utf-8"},
		{target: "/api/data.json", file: "api/data.json", ct: "application/json; charset=utf-8"},
		{target: "/static/app.js", file: "static/app.js", ct: "text/javascript; charset=utf-8"},
	}
	for _, tc := range tests {
		t.Run(tc.target, func(t *testing.T) {
			// act
			rec := ts.serve(appGet(host, tc.target, cookie))

			// assert
			assert.Equal(t, http.StatusOK, rec.Code)
			assert.Equal(t, counterFiles[tc.file], rec.Body.String())
			assert.Equal(t, tc.ct, rec.Header().Get("Content-Type"))
			assert.Empty(t, rec.Header().Get("Service-Worker-Allowed"))
			assert.Equal(t, "scrawl", rec.Header().Get("App-Name"))
		})
	}
}

func TestRunTicketRefuses(t *testing.T) {
	tests := []struct {
		name   string
		opts   testOpts
		file   string
		modify func(r *http.Request)
		status int
		error  string
	}{
		{name: "no origin", file: counterFile, status: http.StatusForbidden,
			modify: func(r *http.Request) { r.Header.Del("Origin") }},
		{name: "a foreign origin", file: counterFile, status: http.StatusForbidden,
			modify: func(r *http.Request) { r.Header.Set("Origin", "http://evil.test") }},
		{name: "an origin that differs from the host", file: counterFile, status: http.StatusForbidden,
			modify: func(r *http.Request) { r.Header.Set("Origin", "http://localhost:7272") }},
		{name: "an origin with a path", file: counterFile, status: http.StatusForbidden,
			modify: func(r *http.Request) { r.Header.Set("Origin", scrawlOrigin+"/x") }},
		{name: "a bearer token", file: counterFile, status: http.StatusForbidden, error: appsNeedBrowser,
			modify: func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+testToken) }},
		{name: "a folder", file: counterFolder, status: http.StatusBadRequest, error: appsNotAnApp},
		{name: "a note", file: "guide.md", status: http.StatusBadRequest, error: appsNotAnApp},
		{name: "a missing file", file: "apps/missing.html", status: http.StatusNotFound},
		{name: "a lan address", file: counterFile, status: http.StatusConflict,
			error: "HTML apps do not run at this address. On this machine, open scrawl at http://127.0.0.1:7272, " +
				"the link it prints at start. From a phone or another device, open scrawl over https with APPS_URL set.",
			modify: func(r *http.Request) {
				r.Host = "192.168.1.5:7272"
				r.Header.Set("Origin", "http://192.168.1.5:7272")
			}},
		{name: "a lan name", file: counterFile, status: http.StatusConflict,
			error: "HTML apps do not run at this address. On this machine, open scrawl at http://127.0.0.1:8080, " +
				"the link it prints at start. From a phone or another device, open scrawl over https with APPS_URL set.",
			modify: func(r *http.Request) {
				r.Host = "notes.home.lan:8080"
				r.Header.Set("Origin", "http://notes.home.lan:8080")
			}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			opts := tc.opts
			opts.withAuth = true
			ts := newAppsServer(t, opts)
			r := ts.runRequest(t, scrawlOrigin, tc.file, false)
			if tc.modify != nil {
				tc.modify(r)
			}

			// act
			rec := ts.serve(r)

			// assert
			assert.Equal(t, tc.status, rec.Code, rec.Body.String())
			if tc.error != "" {
				var res runAnswer
				require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &res))
				assert.Equal(t, tc.error, res.Error)
			}
		})
	}
}

func TestRunTicket(t *testing.T) {
	counterID := htmlapp.ID(testSpace, counterFolder)
	tests := []struct {
		name   string
		opts   testOpts
		origin string
		app    string
	}{
		{name: "local at 127.0.0.1", opts: testOpts{withAuth: true}, origin: scrawlOrigin,
			app: "http://app-" + counterID + ".localhost:7272"},
		{name: "local at ::1", opts: testOpts{withAuth: true}, origin: "http://[::1]:7272",
			app: "http://app-" + counterID + ".localhost:7272"},
		{name: "local at localhost", opts: testOpts{withAuth: true}, origin: "http://localhost:7272",
			app: "http://app-" + counterID + ".localhost:7272"},
		{name: "local at a name under localhost", opts: testOpts{withAuth: true}, origin: "http://scrawl.localhost:7272",
			app: "http://app-" + counterID + ".scrawl.localhost:7272"},
		{name: "local with auth off", opts: testOpts{}, origin: "http://localhost:7272",
			app: "http://app-" + counterID + ".localhost:7272"},
		{name: "a read-only space", opts: testOpts{withAuth: true, spaceReadOnly: true}, origin: scrawlOrigin,
			app: "http://app-" + counterID + ".localhost:7272"},
		{name: "a host per app",
			opts:   testOpts{withAuth: true, apps: "https://app-{id}.example.com", trustedProxy: true},
			origin: "https://notes.example.com", app: "https://app-" + counterID + ".example.com"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			ts := newAppsServer(t, tc.opts)

			// act
			rec := ts.serve(ts.runRequest(t, tc.origin, counterFile, false))

			// assert
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
			var res runAnswer
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &res))
			assert.Equal(t, tc.app+"/index.html", res.App)
			assert.True(t, strings.HasPrefix(res.URL, tc.app+"/__scrawl/enter?t="), res.URL)
		})
	}
}

func TestAppsEnter(t *testing.T) {
	tests := []struct {
		name      string
		fetchSite string
		asked     bool
		offline   bool
		sameSite  http.SameSite
		secure    bool
		parted    bool
	}{
		{name: "same site", fetchSite: "same-site", asked: true, offline: true, sameSite: http.SameSiteLaxMode},
		{name: "no fetch site", sameSite: http.SameSiteLaxMode},
		{name: "cross site keeps nothing offline", fetchSite: "cross-site", asked: true,
			sameSite: http.SameSiteNoneMode, secure: true, parted: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			ts := newAppsServer(t, testOpts{withAuth: true})
			ticket := ts.run(t, scrawlOrigin, counterFile, tc.asked)

			// act
			rec := ts.enter(ticket.URL, tc.fetchSite)

			// assert
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			assert.Empty(t, rec.Header().Get("Location"))
			assert.Equal(t, "default-src 'none'; script-src 'self'; frame-ancestors "+scrawlOrigin,
				rec.Header().Get("Content-Security-Policy"))
			assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
			body := rec.Body.String()
			assert.Contains(t, body, `<body data-file="/index.html" data-parent="`+scrawlOrigin+
				`" data-offline="`+strconv.FormatBool(tc.offline)+`">`)
			assert.Contains(t, body, `<script src="/__scrawl/enter.js"></script>`)
			cookies := rec.Result().Cookies()
			require.Len(t, cookies, 1)
			cookie := cookies[0]
			assert.Equal(t, "scrawl_app", cookie.Name)
			assert.Equal(t, "/", cookie.Path)
			assert.Empty(t, cookie.Domain)
			assert.True(t, cookie.HttpOnly)
			assert.Equal(t, tc.sameSite, cookie.SameSite)
			assert.Equal(t, tc.secure, cookie.Secure)
			assert.Equal(t, tc.parted, cookie.Partitioned)
			assert.Equal(t, int(ts.Auth.TTL()/time.Second), cookie.MaxAge)
		})
	}
}

func TestAppsEnterOverHTTPS(t *testing.T) {
	// arrange
	ts := newAppsServer(t, testOpts{withAuth: true, apps: "https://app-{id}.example.com", trustedProxy: true})
	ticket := ts.run(t, "https://notes.example.com", counterFile, false)

	// act
	rec := ts.enter(ticket.URL, "same-site")

	// assert
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	cookies := rec.Result().Cookies()
	require.Len(t, cookies, 1)
	assert.Equal(t, "__Host-scrawl_app", cookies[0].Name)
	assert.True(t, cookies[0].Secure)
	assert.Equal(t, http.SameSiteLaxMode, cookies[0].SameSite)
}

func TestAppsEnterRefuses(t *testing.T) {
	// arrange
	ts := newAppsServer(t, testOpts{withAuth: true})
	used := ts.run(t, scrawlOrigin, counterFile, false)
	require.Equal(t, http.StatusOK, ts.enter(used.URL, "").Code)
	elsewhere := ts.run(t, scrawlOrigin, counterFile, false)
	payload, err := json.Marshal(htmlapp.Ticket{
		Space: testSpace, Folder: counterFolder, File: "index.html", Parent: scrawlOrigin,
		App: "http://" + appHost(counterFile), Nonce: "n1",
	})
	require.NoError(t, err)
	expired := ts.Auth.Seal(htmlapp.TicketPurpose, testUser, payload, time.Now().Add(-time.Second))
	tests := []struct {
		name string
		url  string
	}{
		{name: "used twice", url: used.URL},
		{name: "expired", url: "http://" + appHost(counterFile) + appsEnter + "?t=" + url.QueryEscape(expired)},
		{name: "taken at another host",
			url: strings.Replace(elsewhere.URL, appHost(counterFile), appHost(otherFile), 1)},
		{name: "no ticket", url: "http://" + appHost(counterFile) + appsEnter},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			rec := ts.enter(tc.url, "")

			// assert
			assert.Equal(t, http.StatusUnauthorized, rec.Code)
			assert.Equal(t, appsExpired+"\n", rec.Body.String())
			assert.Empty(t, rec.Result().Cookies())
		})
	}
}

func TestAppsScripts(t *testing.T) {
	tests := []struct {
		target  string
		asset   string
		allowed string
	}{
		{target: appsEnterJS, asset: "htmlapp/enter.js"},
		{target: appsWorker, asset: "htmlapp/sw.js", allowed: "/"},
	}
	for _, tc := range tests {
		t.Run(tc.target, func(t *testing.T) {
			// arrange
			ts := newAppsServer(t, testOpts{withAuth: true})
			script, err := assets.ReadFile(tc.asset)
			require.NoError(t, err)

			// act
			rec := ts.serve(appGet(appHost(counterFile), tc.target, nil))

			// assert
			assert.Equal(t, http.StatusOK, rec.Code)
			assert.Equal(t, string(script), rec.Body.String())
			assert.Equal(t, "text/javascript; charset=utf-8", rec.Header().Get("Content-Type"))
			assert.Equal(t, "no-cache", rec.Header().Get("Cache-Control"))
			assert.Equal(t, tc.allowed, rec.Header().Get("Service-Worker-Allowed"))
		})
	}
}

func TestAppsMalformedIDAnswers404(t *testing.T) {
	// arrange
	ts := newAppsServer(t, testOpts{withAuth: true})

	// act
	rec := ts.serve(appGet("app-nope.localhost:7272", appsEnterJS, nil))

	// assert
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestAppsFileList(t *testing.T) {
	// arrange
	ts := newAppsServer(t, testOpts{withAuth: true})
	host, cookie := ts.appCookie(t, counterFile)
	entry := func(p, rel string) appsFileEntry {
		fi, err := ts.Spaces[0].Store.Stat(p)
		require.NoError(t, err)
		return appsFileEntry{Path: rel, ETag: rawETag(fi)}
	}
	counter := []appsFileEntry{}
	for _, name := range []string{
		"index.html", "page2.html", "style.css", "app.js", "app.mjs", "app.wasm", "logo.svg",
		"sub/index.html", "sw.js", "api/data.json", "static/app.js",
	} {
		counter = append(counter, entry(counterFolder+"/"+name, name))
	}

	// act
	rec := ts.serve(appGet(host, appsFiles, cookie))

	// assert
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "no-cache", rec.Header().Get("Cache-Control"))
	assert.Equal(t, "application/json; charset=utf-8", rec.Header().Get("Content-Type"))
	var res struct {
		Files []appsFileEntry `json:"files"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &res))
	assert.ElementsMatch(t, counter, res.Files)

	for _, row := range res.Files {
		file := ts.serve(appGet(host, "/"+row.Path, cookie))
		assert.Equal(t, row.ETag, file.Header().Get("ETag"), row.Path)
	}

	etag := rec.Header().Get("ETag")
	require.NotEmpty(t, etag)
	again := appGet(host, appsFiles, cookie)
	again.Header.Set("If-None-Match", etag)
	assert.Equal(t, http.StatusNotModified, ts.serve(again).Code)
}

func TestAppsFileListOfAnAppAtTheRoot(t *testing.T) {
	// arrange
	ts := newAppsServer(t, testOpts{withAuth: true})
	host, cookie := ts.appCookie(t, "root.html")
	entry := func(p string) appsFileEntry {
		fi, err := ts.Spaces[0].Store.Stat(p)
		require.NoError(t, err)
		return appsFileEntry{Path: p, ETag: rawETag(fi)}
	}
	want := []appsFileEntry{
		entry("root.html"), entry("upper.HTM"), entry("secret.js"), entry("images/logo.png"), entry(otherFile),
	}
	for _, name := range []string{
		"index.html", "page2.html", "style.css", "app.js", "app.mjs", "app.wasm", "logo.svg",
		"sub/index.html", "sw.js", "api/data.json", "static/app.js", "__scrawl/sw.js",
	} {
		want = append(want, entry(counterFolder+"/"+name))
	}

	// act
	rec := ts.serve(appGet(host, appsFiles, cookie))

	// assert
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var res struct {
		Files []appsFileEntry `json:"files"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &res))
	assert.ElementsMatch(t, want, res.Files)
}

func TestAppsRefuseAnotherCookie(t *testing.T) {
	// arrange
	ts := newAppsServer(t, testOpts{withAuth: true})
	_, other := ts.appCookie(t, otherFile)
	tests := []struct {
		name   string
		cookie *http.Cookie
		target string
	}{
		{name: "a file with no cookie", target: "/index.html"},
		{name: "a file with the cookie of another app", cookie: other, target: "/index.html"},
		{name: "the list with no cookie", target: appsFiles},
		{name: "the list with the cookie of another app", cookie: other, target: appsFiles},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			rec := ts.serve(appGet(appHost(counterFile), tc.target, tc.cookie))

			// assert
			assert.Equal(t, http.StatusUnauthorized, rec.Code)
			assert.Equal(t, appsNoCookie+"\n", rec.Body.String())
			assert.Equal(t, "text/plain; charset=utf-8", rec.Header().Get("Content-Type"))
			assert.Empty(t, rec.Header().Get("Content-Security-Policy"))
			assert.Equal(t, "scrawl", rec.Header().Get("App-Name"))
		})
	}
}

func TestAppsFiles(t *testing.T) {
	// arrange
	ts := newAppsServer(t, testOpts{withAuth: true})
	host, cookie := ts.appCookie(t, counterFile)
	tests := []struct {
		target string
		status int
		ct     string
		body   string
	}{
		{target: "/", status: http.StatusOK, ct: "text/html; charset=utf-8", body: counterFiles["index.html"]},
		{target: "/index.html", status: http.StatusOK, ct: "text/html; charset=utf-8", body: counterFiles["index.html"]},
		{target: "/sub/", status: http.StatusOK, ct: "text/html; charset=utf-8", body: counterFiles["sub/index.html"]},
		{target: "/app.js", status: http.StatusOK, ct: "text/javascript; charset=utf-8", body: counterFiles["app.js"]},
		{target: "/app.mjs", status: http.StatusOK, ct: "text/javascript; charset=utf-8", body: counterFiles["app.mjs"]},
		{target: "/style.css", status: http.StatusOK, ct: "text/css; charset=utf-8", body: counterFiles["style.css"]},
		{target: "/app.wasm", status: http.StatusOK, ct: "application/wasm", body: counterFiles["app.wasm"]},
		{target: "/logo.svg", status: http.StatusOK, ct: "image/svg+xml", body: counterFiles["logo.svg"]},
		{target: "/notes.md", status: http.StatusNotFound},
		{target: "/.secret.js", status: http.StatusNotFound},
		{target: "/../../.git/config", status: http.StatusNotFound},
		{target: "/../../secret.js", status: http.StatusNotFound},
		{target: "/link.js", status: http.StatusNotFound},
		{target: "/node_modules/x.js", status: http.StatusNotFound},
		{target: "/run.sh", status: http.StatusNotFound},
		{target: "/__scrawl/x", status: http.StatusNotFound},
		{target: "/__scrawl/../__scrawl/sw.js", status: http.StatusNotFound},
		{target: "/missing.html", status: http.StatusNotFound},
	}
	for _, tc := range tests {
		t.Run(tc.target, func(t *testing.T) {
			// act
			rec := ts.serve(appGet(host, tc.target, cookie))

			// assert
			assert.Equal(t, tc.status, rec.Code)
			assert.Equal(t, "frame-ancestors "+scrawlOrigin, rec.Header().Get("Content-Security-Policy"))
			if tc.status != http.StatusOK {
				return
			}
			assert.Equal(t, tc.ct, rec.Header().Get("Content-Type"))
			assert.Equal(t, "private, no-cache", rec.Header().Get("Cache-Control"))
			assert.NotEmpty(t, rec.Header().Get("ETag"))
			if tc.body != "" {
				assert.Equal(t, tc.body, rec.Body.String())
			}
		})
	}
}

func TestAppsFileRedirectsAFolderWithoutTheSlash(t *testing.T) {
	// arrange
	ts := newAppsServer(t, testOpts{withAuth: true})
	host, cookie := ts.appCookie(t, counterFile)

	// act
	rec := ts.serve(appGet(host, "/sub?x=1", cookie))

	// assert
	assert.Equal(t, http.StatusMovedPermanently, rec.Code)
	assert.Equal(t, "/sub/?x=1", rec.Header().Get("Location"))
}

func TestAppsFileRangeAndETag(t *testing.T) {
	// arrange
	ts := newAppsServer(t, testOpts{withAuth: true})
	host, cookie := ts.appCookie(t, counterFile)
	ranged := appGet(host, "/index.html", cookie)
	ranged.Header.Set("Range", "bytes=0-2")
	first := ts.serve(appGet(host, "/index.html", cookie))
	cached := appGet(host, "/index.html", cookie)
	cached.Header.Set("If-None-Match", first.Header().Get("ETag"))

	// act
	part := ts.serve(ranged)
	notModified := ts.serve(cached)

	// assert
	assert.Equal(t, http.StatusPartialContent, part.Code)
	assert.Equal(t, counterFiles["index.html"][:3], part.Body.String())
	assert.Equal(t, http.StatusNotModified, notModified.Code)
}

func TestAppsHostAllowsOnlyGetAndHead(t *testing.T) {
	// arrange
	ts := newAppsServer(t, testOpts{withAuth: true})
	host, cookie := ts.appCookie(t, counterFile)
	post := httptest.NewRequest(http.MethodPost, "http://"+host+"/index.html", http.NoBody)
	post.AddCookie(cookie)
	head := appGet(host, "/index.html", cookie)
	head.Method = http.MethodHead

	// act
	posted := ts.serve(post)
	headed := ts.serve(head)

	// assert
	assert.Equal(t, http.StatusMethodNotAllowed, posted.Code)
	assert.Equal(t, http.StatusOK, headed.Code)
}

func TestScrawlHostPolicy(t *testing.T) {
	tests := []struct {
		name   string
		apps   string
		frames string
	}{
		{name: "local", frames: "frame-src http://*.localhost:* https://*.localhost:*"},
		{name: "a host per app", apps: "http://app-{id}.example.com", frames: "frame-src http://*.example.com"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			ts := newAppsServer(t, testOpts{apps: tc.apps})

			for _, target := range []string{"/", "/api/me", offlineShellBase + ts.offline.shellFile} {
				// act
				resp, _ := ts.do(t, request{path: target})

				// assert
				policy := resp.header.Get("Content-Security-Policy")
				assert.True(t, strings.HasSuffix(policy, "; "+tc.frames), target+": "+policy)
				assert.Equal(t, "same-origin", resp.header.Get("Cross-Origin-Resource-Policy"), target)
			}
		})
	}
}

func TestScrawlHostRefusesAPostFromAnApp(t *testing.T) {
	// arrange
	ts := newAppsServer(t, testOpts{withAuth: true})
	r := httptest.NewRequest(http.MethodPut, scrawlOrigin+ts.prefix()+"/api/file/x.md", strings.NewReader(`{}`))
	r.Header.Set("Origin", "http://"+appHost(counterFile))
	r.Header.Set("Sec-Fetch-Site", "same-site")
	ts.addSession(t, r)

	// act
	rec := ts.serve(r)

	// assert
	assert.Equal(t, http.StatusForbidden, rec.Code)
}

func TestRunURLOnAFilePage(t *testing.T) {
	tests := []struct {
		file string
		want string
	}{
		{file: counterFile, want: "/run/" + counterFile},
		{file: "upper.HTM", want: "/run/upper.HTM"},
		{file: "snippet.py"},
		{file: "secret.js"},
	}
	for _, tc := range tests {
		t.Run(tc.file, func(t *testing.T) {
			// arrange
			ts := newAppsServer(t, testOpts{})

			// act
			resp, body := ts.do(t, request{path: "/api/page/" + tc.file})

			// assert
			require.Equal(t, http.StatusOK, resp.status, body)
			var res struct {
				RunURL string `json:"run_url"`
			}
			require.NoError(t, json.Unmarshal([]byte(body), &res))
			assert.Equal(t, tc.want, res.RunURL)
		})
	}
}

func TestRunScreenIsThePage(t *testing.T) {
	// arrange
	ts := newAppsServer(t, testOpts{})

	// act
	resp, body := ts.do(t, request{path: "/run/" + counterFile})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Contains(t, body, `id="scrawl-app-root"`)
}

func TestOfflineShellFollowsTheAppsSetting(t *testing.T) {
	// arrange
	local := newAppsServer(t, testOpts{})
	perApp := newAppsServer(t, testOpts{apps: "https://app-{id}.example.com"})
	_, localScript := local.do(t, request{path: "/sw.js", literal: true})
	_, perAppScript := perApp.do(t, request{path: "/sw.js", literal: true})

	// act
	resp, _ := perApp.do(t, request{path: offlineShellBase + perApp.offline.shellFile})

	// assert
	assert.Equal(t, local.Version, perApp.Version)
	assert.NotEqual(t, local.offline.shellFile, perApp.offline.shellFile)
	assert.NotEqual(t, workerConfigOf(t, localScript).Build, workerConfigOf(t, perAppScript).Build)
	assert.Contains(t, resp.header.Get("Content-Security-Policy"), "frame-src https://*.example.com")
}
