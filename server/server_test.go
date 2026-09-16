package server

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io"
	"io/fs"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/auth"
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/search"
	"github.com/aleksey925/scrawl/store"
)

const testUser = "bob"

const testPassword = "s3cret"

// the API tokens the test server accepts, one of each scope.
const (
	testToken     = "scrawl_test-read-write"
	testReadToken = "scrawl_test-read-only"
)

// testProject is the one project every test server serves. It is named rather
// than empty on purpose: the prefix is non-empty in every run of the real
// binary, so a URL built without it has to fail here too.
const testProject = "notes"

// globalPaths are the routes that answer at the root instead of inside a
// project. It is the server's own boundary - does this read a store - written
// down once, so a test names the path it means and the helper decides which
// tree that path lives in.
var globalPaths = []string{
	"/ping", "/static/", "/manifest.webmanifest",
	"/login", "/logout", "/api/login", "/api/logout", "/api/projects",
}

// testServer is a whole app over a temporary notes directory.
type testServer struct {
	*Web
	url string
	// root is the notes directory of the first project, secondRoot that of the
	// second one when testOpts named it.
	root       string
	secondRoot string
}

// second is the project testOpts.second asked for.
func (ts *testServer) second() *Project { return ts.Projects[1] }

// prefix is where this server's only project answers.
func (ts *testServer) prefix() string { return projectPrefix + testProject }

// mount is the project bound to the server, which is the receiver every
// handler that reads a store hangs off.
func (ts *testServer) mount() *mount { return &mount{Web: ts.Web, prj: ts.Projects[0]} }

// resolve turns a path a test names into the one the server answers. "/" is the
// project's own root, not the server's: a test that means the redirect at the
// server root asks for it literally.
func (ts *testServer) resolve(p string) string {
	for _, global := range globalPaths {
		if p == global || strings.HasPrefix(p, global) || strings.HasPrefix(p, global+"?") {
			return p
		}
	}
	return ts.prefix() + p
}

type testOpts struct {
	readOnly        bool // the whole server
	projectReadOnly bool // this project alone
	withAuth        bool
	history         History

	// second names a project served beside the first one, over a root of its
	// own. Empty leaves the server with one project, which is what most tests
	// need; naming it is what a test of the boundary between two projects asks
	// for.
	second string
}

func newTestServer(t *testing.T, opts testOpts) *testServer {
	t.Helper()
	root := testNotes(t)

	users, tokens := "", ""
	if opts.withAuth {
		users = testUser + ":" + testPassword
		tokens = "agent:" + auth.TokenDigest(testToken) + ",reader:" + auth.TokenDigest(testReadToken) + ":ro"
	}
	svc, err := auth.NewService(auth.Config{
		Users:    users,
		Tokens:   tokens,
		Secret:   "test-signing-secret",
		Disabled: !opts.withAuth,
		TTL:      time.Hour,
	})
	require.NoError(t, err)

	prj := testProjectAt(t, testProject, root, opts.readOnly || opts.projectReadOnly)
	prj.ReadOnly = opts.projectReadOnly
	prj.History = opts.history

	wb := &Web{
		Config: Config{
			Title:        "Test Notes",
			Version:      "v1.2.3",
			ReadOnly:     opts.readOnly,
			MaxUpload:    64 << 10,
			AuthDisabled: !opts.withAuth,
		},
		Projects: []*Project{prj},
		Auth:     svc,
	}
	res := &testServer{Web: wb, root: root}
	if opts.second != "" {
		res.secondRoot = t.TempDir()
		wb.Projects = append(wb.Projects, testProjectAt(t, opts.second, res.secondRoot, false))
	}

	router, err := wb.router()
	require.NoError(t, err)
	ts := httptest.NewServer(router)
	t.Cleanup(ts.Close)
	res.url = ts.URL

	return res
}

// testProjectAt builds one project over a directory, indexed and rendered the
// way main builds one.
func testProjectAt(t *testing.T, name, root string, readOnly bool) *Project {
	t.Helper()
	notes, err := store.New(store.Config{Root: root, ReadOnly: readOnly, Rescan: -1})
	require.NoError(t, err)
	t.Cleanup(func() { _ = notes.Close() })

	index := search.New()
	require.NoError(t, notes.Walk(func(fi store.FileInfo, data []byte) error {
		index.Set(fi.Path, data)
		return nil
	}))

	prj := &Project{Name: name, Kind: KindLocal, Store: notes, Index: index}
	prj.Renderer = render.New(render.Options{
		LinkExists: notes.Exists,
		PagePrefix: prj.Prefix() + "/doc/",
		RawPrefix:  prj.Prefix() + "/raw/",
	})
	return prj
}

// testNotes writes a small notes tree covering every shape the handlers have
// to tell apart: a root index, a directory with its own index, a directory with
// only a readme, a non-markdown attachment and a Cyrillic document.
func testNotes(t *testing.T) string {
	t.Helper()
	root := t.TempDir()

	files := map[string][]byte{
		"index.md":          []byte("# Home\n\nWelcome, see the [guide](guide.md).\n"),
		"guide.md":          []byte("# Guide\n\n## Setup\n\nwidgets and gadgets\n\n## Usage\n\n### Details\n\nmore text\n"),
		"notes/index.md":    []byte("# Notes\n\nthe notes index\n"),
		"notes/cyrillic.md": []byte("# Заметки\n\n## Общее\n\nтекст про поиск\n"),
		"docs/README.md":    []byte("# Docs\n\nthe intro above the listing\n"),
		"docs/page.md":      []byte("# Page\n\nplain body\n"),
		"docs/sub/deep.md":  []byte("# Deep\n\nnested body\n"),
		"long.markdown":     []byte("# Long extension\n\nkumquat body\n"),
		"links.md":          []byte("# Links\n\n[long](long.markdown)\n"),
		"snippet.py":        []byte("print('hi')\n"),
		"images/logo.png":   tinyPNG(t),
	}
	for name, data := range files {
		full := filepath.Join(root, filepath.FromSlash(name))
		require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o750))
		require.NoError(t, os.WriteFile(full, data, 0o600))
	}
	return root
}

func tinyPNG(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 1, 1))))
	return buf.Bytes()
}

// request is one call against the test server. path is resolved through
// testServer.resolve unless literal is set, which is what a test asking about
// a path outside every project needs.
type request struct {
	method  string
	path    string
	literal bool
	body    io.Reader
	headers map[string]string
	client  *http.Client
}

// response is the part of an answer the tests look at. do drains and closes
// the body before it returns, so nothing here has to be released.
type response struct {
	status int
	header http.Header
}

func (ts *testServer) do(t *testing.T, req request) (response, string) {
	t.Helper()
	if req.method == "" {
		req.method = http.MethodGet
	}
	body := req.body
	if body == nil {
		body = http.NoBody
	}
	target := req.path
	if !req.literal {
		target = ts.resolve(target)
	}

	httpReq, err := http.NewRequestWithContext(t.Context(), req.method, ts.url+target, body)
	require.NoError(t, err)
	for name, value := range req.headers {
		httpReq.Header.Set(name, value)
	}

	client := req.client
	if client == nil {
		client = noRedirectClient(t)
	}
	resp, err := client.Do(httpReq)
	require.NoError(t, err)
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return response{status: resp.StatusCode, header: resp.Header}, string(data)
}

func (ts *testServer) json(t *testing.T, req request) (response, map[string]any) {
	t.Helper()
	if req.headers == nil {
		req.headers = map[string]string{}
	}
	req.headers["Accept"] = "application/json"

	resp, body := ts.do(t, req)
	res := map[string]any{}
	if body != "" {
		require.NoError(t, json.Unmarshal([]byte(body), &res), "body: %s", body)
	}
	return resp, res
}

func jsonBody(t *testing.T, v any) io.Reader {
	t.Helper()
	data, err := json.Marshal(v)
	require.NoError(t, err)
	return bytes.NewReader(data)
}

func noRedirectClient(t *testing.T) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	return &http.Client{
		Jar:           jar,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// login signs in and returns a client carrying the session cookie.
func (ts *testServer) login(t *testing.T) *http.Client {
	t.Helper()
	client := noRedirectClient(t)
	form := url.Values{"username": {testUser}, "password": {testPassword}}

	resp, _ := ts.do(t, request{
		method:  http.MethodPost,
		path:    "/login",
		body:    strings.NewReader(form.Encode()),
		headers: map[string]string{"Content-Type": "application/x-www-form-urlencoded"},
		client:  client,
	})
	require.Equal(t, http.StatusSeeOther, resp.status)
	return client
}

func TestStaticAndPing(t *testing.T) {
	ts := newTestServer(t, testOpts{})

	tests := []struct {
		name        string
		path        string
		status      int
		body        string
		contentType string
	}{
		{name: "ping", path: "/ping", status: http.StatusOK, body: "pong", contentType: "text/plain"},
		// chroma is generated by render at runtime rather than built, so it is
		// the one stylesheet vite cannot carry and the shell links it itself
		{name: "generated chroma css", path: "/static/v1.2.3/css/chroma.css", status: http.StatusOK, contentType: "text/css"},
		{name: "app manifest", path: "/static/v1.2.3/app/manifest.json", status: http.StatusOK},
		{name: "favicon", path: "/static/v1.2.3/favicon.svg", status: http.StatusOK, contentType: "image/svg+xml"},
		{name: "missing asset", path: "/static/v1.2.3/css/nope.css", status: http.StatusNotFound},
		{name: "empty asset path", path: "/static/v1.2.3/", status: http.StatusNotFound},
		{name: "templates are not assets", path: "/static/v1.2.3/../templates/login.html", status: http.StatusMovedPermanently},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, body := ts.do(t, request{path: tc.path})

			// assert
			assert.Equal(t, tc.status, resp.status)
			if tc.body != "" {
				assert.Equal(t, tc.body, body)
			}
			if tc.contentType != "" {
				assert.Contains(t, resp.header.Get("Content-Type"), tc.contentType)
			}
		})
	}
}

func TestTextResponsesAreCompressedAndBinaryOnesAreNot(t *testing.T) {
	ts := newTestServer(t, testOpts{})

	tests := []struct {
		name     string
		path     string
		encoding string
	}{
		{name: "app shell", path: "/", encoding: "gzip"},
		{name: "generated chroma css", path: "/static/v1.2.3/css/chroma.css", encoding: "gzip"},
		{name: "app manifest", path: "/static/v1.2.3/app/manifest.json", encoding: "gzip"},
		{name: "favicon", path: "/static/v1.2.3/favicon.svg", encoding: "gzip"},
		{name: "json api", path: "/api/tree", encoding: "gzip"},
		{name: "raw markdown", path: "/raw/index.md", encoding: "gzip"},
		{name: "raw png", path: "/raw/images/logo.png"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, _ := ts.do(t, request{path: tc.path, headers: map[string]string{"Accept-Encoding": "gzip"}})

			// assert
			assert.Equal(t, http.StatusOK, resp.status)
			assert.Equal(t, tc.encoding, resp.header.Get("Content-Encoding"))
			assert.Equal(t, "Accept-Encoding", resp.header.Get("Vary"),
				"caches have to key on the encoding even when nothing was compressed")
		})
	}
}

func TestCompressedBodyDecodesToTheIdentityOne(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	identity, plain := ts.do(t, request{path: "/", headers: map[string]string{"Accept-Encoding": "identity"}})

	// act
	resp, packed := ts.do(t, request{path: "/", headers: map[string]string{"Accept-Encoding": "gzip"}})

	// assert
	assert.Empty(t, identity.header.Get("Content-Encoding"))
	assert.Equal(t, "gzip", resp.header.Get("Content-Encoding"))
	assert.Less(t, len(packed), len(plain))
	reader, err := gzip.NewReader(strings.NewReader(packed))
	require.NoError(t, err)
	decoded, err := io.ReadAll(reader)
	require.NoError(t, err)

	// the shell mints a fresh style nonce per response, so two answers are never
	// byte for byte the same. Everything either side of it still has to be.
	nonce := regexp.MustCompile(`content="[A-Za-z0-9_-]{22}"`)
	assert.Equal(t, nonce.ReplaceAllString(plain, `content="x"`),
		nonce.ReplaceAllString(string(decoded), `content="x"`))
}

func TestPingIsExactAndDoesNotShadowContent(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})

	tests := []struct {
		name   string
		path   string
		status int
	}{
		{name: "the ping route", path: "/ping", status: http.StatusOK},
		{name: "a document path ending in ping", path: "/doc/notes/ping", status: http.StatusFound},
		{name: "an api path ending in ping", path: "/api/file/x/ping", status: http.StatusUnauthorized},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, _ := ts.do(t, request{path: tc.path})

			// assert
			assert.Equal(t, tc.status, resp.status)
		})
	}
}

func TestBuildVersionIsNotShownToStrangers(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})

	// act
	anonymous, _ := ts.do(t, request{path: "/login"})
	ping, _ := ts.do(t, request{path: "/ping"})
	authenticated, _ := ts.do(t, request{path: "/", client: ts.login(t)})

	// assert
	assert.Empty(t, anonymous.header.Get("App-Version"))
	assert.Empty(t, ping.header.Get("App-Version"))
	assert.Equal(t, "v1.2.3", authenticated.header.Get("App-Version"))
}

func TestSecurityHeaders(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, _ := ts.do(t, request{path: "/"})

	// assert
	assert.Equal(t, "nosniff", resp.header.Get("X-Content-Type-Options"))
	assert.Equal(t, "same-origin", resp.header.Get("Referrer-Policy"))
	assert.Equal(t, "DENY", resp.header.Get("X-Frame-Options"))
	assert.Equal(t, "scrawl", resp.header.Get("App-Name"))
	assert.Equal(t, "v1.2.3", resp.header.Get("App-Version"))

	policy := resp.header.Get("Content-Security-Policy")
	assert.Contains(t, policy, "default-src 'none'")
	assert.Contains(t, policy, "connect-src 'self'")
	assert.Contains(t, policy, "script-src 'self'")
	assert.Regexp(t, `style-src-elem 'self' 'nonce-[A-Za-z0-9_-]+'`, policy)
}

// TestPageRoutesServeTheApp checks what the server still decides for itself now
// that every page is the app: the status of a reading url, and the one path that
// is not a page at all. What the app then draws is the browser suite's business.
func TestPageRoutesServeTheApp(t *testing.T) {
	ts := newTestServer(t, testOpts{})

	tests := []struct {
		name     string
		path     string
		status   int
		location string
	}{
		{name: "root", path: "/", status: http.StatusOK},
		{name: "document", path: "/doc/guide.md", status: http.StatusOK},
		{name: "directory", path: "/doc/notes/", status: http.StatusOK},
		{name: "editor", path: "/edit/guide.md", status: http.StatusOK},
		{name: "history", path: "/history/guide.md", status: http.StatusOK},
		{name: "search", path: "/search?q=widgets", status: http.StatusOK},
		// a link to a note that is not there keeps answering 404: the status is
		// all a crawler or a link checker reads, and neither runs the router
		{name: "missing document", path: "/doc/nope.md", status: http.StatusNotFound},
		// an attachment is not a page, so it goes to the route that serves files
		// under a content type from an allowlist
		{name: "attachment redirects to raw", path: "/doc/snippet.py", status: http.StatusFound,
			location: "/raw/snippet.py"},
		{name: "unknown route", path: "/nothing", status: http.StatusNotFound},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, body := ts.do(t, request{path: tc.path})

			// assert
			assert.Equal(t, tc.status, resp.status)
			if tc.location != "" {
				assert.Equal(t, ts.prefix()+tc.location, resp.header.Get("Location"))
				return
			}
			if tc.status == http.StatusOK || tc.path == "/doc/nope.md" {
				assert.Contains(t, body, `id="scrawl-app-root"`)
			}
		})
	}
}

func TestOutlineRailCountsOnlyTheHeadingsItLists(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	require.NoError(t, os.WriteFile(filepath.Join(ts.root, "flat.md"),
		[]byte("# One\n\n# Two\n\n# Three\n"), 0o600))

	// act
	_, flat := ts.json(t, request{path: "/api/page/flat.md"})
	_, listed := ts.json(t, request{path: "/api/page/guide.md"})

	// assert
	assert.Equal(t, false, flat["show_toc"], "three h1 headings are no outline")
	assert.Empty(t, flat["toc"])
	assert.Equal(t, true, listed["show_toc"])
	assert.NotEmpty(t, listed["toc"])
}

func TestOnlyDotMDIsADocument(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	view, _ := ts.do(t, request{path: "/doc/long.markdown"})
	_, linking := ts.json(t, request{path: "/api/page/links.md"})
	_, found := ts.json(t, request{path: "/api/search?q=kumquat"})

	// assert
	assert.Equal(t, http.StatusFound, view.status)
	assert.Equal(t, ts.prefix()+"/raw/long.markdown", view.header.Get("Location"))
	assert.Contains(t, linking["html"], `href="`+ts.prefix()+`/raw/long.markdown"`,
		"the renderer sends a .markdown link to the file route, not to a page")
	assert.Empty(t, found["hits"])

	paths := []string{}
	for _, node := range ts.mount().treeNodes("") {
		paths = append(paths, node.Path)
	}
	assert.Equal(t, []string{"docs", "images", "notes", "guide.md", "index.md", "links.md"}, paths)
}

func TestViewNeverLeaksTheFilesystemPath(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	_, page := ts.do(t, request{path: "/doc/nope/"})
	_, api := ts.do(t, request{path: "/api/file/nope.md"})

	// assert
	assert.NotContains(t, page, ts.root)
	assert.NotContains(t, api, ts.root)
}

func TestRawServing(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, body := ts.do(t, request{path: "/raw/images/logo.png"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, "image/png", resp.header.Get("Content-Type"))
	assert.Equal(t, "private, max-age=300", resp.header.Get("Cache-Control"))
	assert.NotEmpty(t, resp.header.Get("ETag"))
	assert.Equal(t, "bytes", resp.header.Get("Accept-Ranges"))
	assert.Equal(t, string(tinyPNG(t)), body)
}

func TestRawConditionalAndRange(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	first, _ := ts.do(t, request{path: "/raw/images/logo.png"})
	etag := first.header.Get("ETag")

	tests := []struct {
		name    string
		headers map[string]string
		status  int
		length  int
	}{
		{name: "not modified", headers: map[string]string{"If-None-Match": etag}, status: http.StatusNotModified},
		{name: "range", headers: map[string]string{"Range": "bytes=0-9"}, status: http.StatusPartialContent, length: 10},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, body := ts.do(t, request{path: "/raw/images/logo.png", headers: tc.headers})

			// assert
			assert.Equal(t, tc.status, resp.status)
			assert.Len(t, body, tc.length)
		})
	}
}

func TestRawNeverServesAnExecutableDocument(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	payloads := map[string][]byte{
		"evil.html":  []byte("<html><body><script src=\"/raw/evil.js\"></script></body></html>"),
		"evil.js":    []byte("document.title='PWNED'"),
		"evil.svg":   []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
		"evil.xhtml": []byte("<html xmlns=\"http://www.w3.org/1999/xhtml\"><body/></html>"),
		"evil.xml":   []byte("<?xml version=\"1.0\"?><root/>"),
		"noext":      []byte("<html><body>sniff me</body></html>"),
	}
	for name, data := range payloads {
		require.NoError(t, os.WriteFile(filepath.Join(ts.root, name), data, 0o600))
	}

	tests := []struct {
		name        string
		path        string
		contentType string
		disposition string
	}{
		{name: "html", path: "/raw/evil.html", contentType: "application/octet-stream",
			disposition: `attachment; filename=evil.html`},
		{name: "javascript", path: "/raw/evil.js", contentType: "application/octet-stream",
			disposition: `attachment; filename=evil.js`},
		{name: "svg keeps its type but downloads", path: "/raw/evil.svg", contentType: "image/svg+xml",
			disposition: `attachment; filename=evil.svg`},
		{name: "xhtml", path: "/raw/evil.xhtml", contentType: "application/octet-stream",
			disposition: `attachment; filename=evil.xhtml`},
		{name: "xml", path: "/raw/evil.xml", contentType: "application/octet-stream",
			disposition: `attachment; filename=evil.xml`},
		{name: "no extension is never sniffed", path: "/raw/noext", contentType: "application/octet-stream",
			disposition: `attachment; filename=noext`},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, _ := ts.do(t, request{path: tc.path})

			// assert
			assert.Equal(t, http.StatusOK, resp.status)
			assert.Equal(t, tc.contentType, resp.header.Get("Content-Type"))
			assert.Equal(t, tc.disposition, resp.header.Get("Content-Disposition"))
			assert.Equal(t, rawContentSecurityPolicy, resp.header.Get("Content-Security-Policy"))
			assert.Equal(t, "nosniff", resp.header.Get("X-Content-Type-Options"))
		})
	}
}

func TestRawServesSafeTypesInline(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	tests := []struct {
		name        string
		path        string
		contentType string
	}{
		{name: "png", path: "/raw/images/logo.png", contentType: "image/png"},
		{name: "markdown source", path: "/raw/guide.md", contentType: "text/plain; charset=utf-8"},
		{name: "code snippet", path: "/raw/snippet.py", contentType: "text/plain; charset=utf-8"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, _ := ts.do(t, request{path: tc.path})

			// assert
			assert.Equal(t, http.StatusOK, resp.status)
			assert.Equal(t, tc.contentType, resp.header.Get("Content-Type"))
			assert.Empty(t, resp.header.Get("Content-Disposition"))
			assert.Equal(t, rawContentSecurityPolicy, resp.header.Get("Content-Security-Policy"))
		})
	}
}

func TestRawMissing(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, _ := ts.do(t, request{path: "/raw/images/nope.png"})

	// assert
	assert.Equal(t, http.StatusNotFound, resp.status)
}

func TestAPITree(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, body := ts.json(t, request{path: "/api/tree"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	names := []string{}
	for _, node := range body["tree"].([]any) {
		names = append(names, node.(map[string]any)["name"].(string))
	}
	assert.Equal(t, []string{"docs", "images", "notes", "guide.md", "index.md", "links.md"}, names,
		"every folder is listed, and of the files only the documents")
}

func TestAPITreeDirsOnly(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, body := ts.json(t, request{path: "/api/tree?dirs=1"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	names := []string{}
	for _, node := range body["tree"].([]any) {
		names = append(names, node.(map[string]any)["name"].(string))
	}
	assert.Equal(t, []string{"docs", "images", "notes"}, names,
		"the destination picker asks for folders, so the documents are left out")
}

func TestTreeKeepsEveryFolder(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	require.NoError(t, os.MkdirAll(filepath.Join(ts.root, "attachments"), 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(ts.root, "attachments", "shot.png"), tinyPNG(t), 0o600))
	require.NoError(t, os.MkdirAll(filepath.Join(ts.root, "empty"), 0o750))

	// act
	nodes := ts.mount().treeNodes("")

	// assert
	paths := []string{}
	for _, node := range nodes {
		paths = append(paths, node.Path)
	}
	assert.Equal(t, []string{"attachments", "docs", "empty", "images", "notes",
		"guide.md", "index.md", "links.md"}, paths,
		"a folder is where a page is created, so it is listed before it holds one")
}

func TestTreeDirectoriesCarryTheirPageURL(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	nodes := ts.mount().treeNodes("docs/page.md")

	// assert
	docs := nodes[0]
	require.True(t, docs.IsDir)
	assert.Equal(t, "/doc/docs/", docs.URL)
	assert.True(t, docs.Active)
	assert.False(t, docs.Current, "the current page is the document, not the folder holding it")
	assert.Equal(t, "/doc/docs/sub/", docs.Children[0].URL)
}

func TestTreeMarksTheFolderBeingViewed(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	nodes := ts.mount().treeNodes("docs/sub")

	// assert
	docs := nodes[0]
	require.Equal(t, "docs", docs.Path)
	assert.True(t, docs.Active)
	assert.False(t, docs.Current)
	assert.True(t, docs.Children[0].Current)
	assert.True(t, docs.Children[0].Active, "the current folder is also on its own path")
}

// TestNavMarksTheFolderBeingViewed keeps the flags the sidebar draws itself
// from. A folder is the one case that has to carry both: it is the page being
// read and an ancestor of nothing, and it once went unmarked entirely.
func TestNavMarksTheFolderBeingViewed(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	page, _ := ts.do(t, request{path: "/doc/docs/sub/"})
	_, nav := ts.json(t, request{path: "/api/nav?path=docs/sub"})

	// assert
	assert.Equal(t, http.StatusOK, page.status)

	docs, ok := nav["tree"].([]any)
	require.True(t, ok)
	require.NotEmpty(t, docs)
	top, ok := docs[0].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "docs", top["path"])
	assert.Equal(t, true, top["active"], "the branch holding the page is open")

	children, ok := top["children"].([]any)
	require.True(t, ok)
	require.NotEmpty(t, children)
	sub, ok := children[0].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "docs/sub", sub["path"])
	assert.Equal(t, true, sub["current"])
	assert.Equal(t, "/doc/docs/sub/", sub["url"])
}

func TestAPIFileGet(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, body := ts.json(t, request{path: "/api/file/guide.md"})

	// assert
	source, _, err := ts.Projects[0].Store.Read("guide.md")
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, "guide.md", body["path"])
	assert.Equal(t, string(source), body["content"])
	assert.Equal(t, store.Rev(source), body["rev"])
	assert.InDelta(t, float64(len(source)), body["size"], 0)
}

func TestAPIFileGetRefusesLargeAndBinaryFiles(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	huge := filepath.Join(ts.root, "huge.md")
	require.NoError(t, os.WriteFile(huge, bytes.Repeat([]byte("a"), maxEditableFile+1), 0o600))

	tests := []struct {
		name   string
		path   string
		status int
		error  string
	}{
		{name: "over the editing cap", path: "/api/file/huge.md",
			status: http.StatusRequestEntityTooLarge, error: "file is too large to edit, read it from /raw/"},
		{name: "binary attachment", path: "/api/file/images/logo.png",
			status: http.StatusUnsupportedMediaType, error: "not a text file, read it from /raw/"},
		{name: "directory", path: "/api/file/notes", status: http.StatusBadRequest, error: "path is a directory"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, body := ts.json(t, request{path: tc.path})

			// assert
			assert.Equal(t, tc.status, resp.status)
			assert.Equal(t, tc.error, body["error"])
		})
	}
}

func TestAPIFileLifecycle(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act & assert
	created, body := ts.json(t, request{
		method: http.MethodPost, path: "/api/file/new/page.md", body: jsonBody(t, map[string]string{"type": "file"}),
	})
	require.Equal(t, http.StatusCreated, created.status)
	assert.Equal(t, "new/page.md", body["path"])

	saved, body := ts.json(t, request{
		method: http.MethodPut, path: "/api/file/new/page.md",
		body: jsonBody(t, map[string]string{"content": "# Fresh\n", "rev": store.Rev(nil)}),
	})
	require.Equal(t, http.StatusOK, saved.status)
	assert.Equal(t, store.Rev([]byte("# Fresh\n")), body["rev"])

	moved, body := ts.json(t, request{
		method: http.MethodPost, path: "/api/move",
		body: jsonBody(t, map[string]string{"from": "new/page.md", "to": "new/renamed.md"}),
	})
	require.Equal(t, http.StatusOK, moved.status)
	assert.Equal(t, "new/renamed.md", body["path"])

	removed, _ := ts.do(t, request{method: http.MethodDelete, path: "/api/file/new/renamed.md"})
	assert.Equal(t, http.StatusOK, removed.status)
	assert.False(t, ts.Projects[0].Store.Exists("new/renamed.md"))
}

func TestAPIFileSaveConflict(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	original, _, err := ts.Projects[0].Store.Read("guide.md")
	require.NoError(t, err)
	_, err = ts.Projects[0].Store.Write("guide.md", []byte("# Changed on disk\n"), store.Rev(original))
	require.NoError(t, err)

	// act
	resp, body := ts.json(t, request{
		method: http.MethodPut, path: "/api/file/guide.md",
		body: jsonBody(t, map[string]string{"content": "# My edit\n", "rev": store.Rev(original)}),
	})

	// assert
	assert.Equal(t, http.StatusPreconditionFailed, resp.status)
	assert.Equal(t, "conflict", body["error"])
	assert.Equal(t, store.Rev([]byte("# Changed on disk\n")), body["current_rev"])
	assert.Equal(t, "# Changed on disk\n", body["current_content"])
}

func TestAPIFileSaveOntoAnExistingFile(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	current, _, err := ts.Projects[0].Store.Read("guide.md")
	require.NoError(t, err)

	// act
	resp, body := ts.json(t, request{
		method: http.MethodPut, path: "/api/file/guide.md",
		body: jsonBody(t, map[string]string{"content": "# My edit\n", "rev": ""}),
	})

	// assert
	assert.Equal(t, http.StatusConflict, resp.status)
	assert.Equal(t, "already exists", body["error"])
	assert.Equal(t, store.Rev(current), body["current_rev"])
	assert.Equal(t, string(current), body["current_content"])
}

func TestAPISaveRefreshesTheSearchIndex(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	require.Empty(t, ts.Projects[0].Index.Search("kumquat", 5))

	// act
	resp, _ := ts.json(t, request{
		method: http.MethodPut, path: "/api/file/guide.md",
		body: jsonBody(t, map[string]string{"content": "# Guide\n\nkumquat\n", "rev": revOf(t, ts, "guide.md")}),
	})

	// assert
	require.Equal(t, http.StatusOK, resp.status)
	hits := ts.Projects[0].Index.Search("kumquat", 5)
	require.Len(t, hits, 1)
	assert.Equal(t, "guide.md", hits[0].Path)
}

func TestAPIErrorStatuses(t *testing.T) {
	ts := newTestServer(t, testOpts{})

	tests := []struct {
		name    string
		method  string
		path    string
		body    any
		status  int
		message string
	}{
		{name: "missing file", method: http.MethodGet, path: "/api/file/nope.md",
			status: http.StatusNotFound, message: "not found"},
		{name: "hidden entry", method: http.MethodGet, path: "/api/file/.git/config",
			status: http.StatusNotFound, message: "not found"},
		{name: "file is a directory", method: http.MethodGet, path: "/api/file/notes",
			status: http.StatusBadRequest, message: "path is a directory"},
		{name: "empty path", method: http.MethodGet, path: "/api/file/",
			status: http.StatusBadRequest, message: "bad path"},
		{name: "create over an existing file", method: http.MethodPost, path: "/api/file/guide.md",
			body: map[string]string{"type": "file"}, status: http.StatusConflict, message: "already exists"},
		{name: "create with a bad type", method: http.MethodPost, path: "/api/file/other.md",
			body: map[string]string{"type": "symlink"}, status: http.StatusBadRequest},
		{name: "remove a directory that is not empty", method: http.MethodDelete, path: "/api/file/notes",
			status: http.StatusConflict, message: "directory is not empty"},
		{name: "remove something missing", method: http.MethodDelete, path: "/api/file/nope.md",
			status: http.StatusNotFound, message: "not found"},
		{name: "move onto an existing file", method: http.MethodPost, path: "/api/move",
			body:   map[string]string{"from": "guide.md", "to": "index.md"},
			status: http.StatusConflict, message: "already exists"},
		{name: "move without a target", method: http.MethodPost, path: "/api/move",
			body: map[string]string{"from": "guide.md"}, status: http.StatusBadRequest},
		{name: "escaping the root", method: http.MethodGet, path: "/api/file/..%2f..%2fetc%2fpasswd",
			status: http.StatusBadRequest, message: "forbidden"},
		{name: "search with a bad limit", method: http.MethodGet, path: "/api/search?q=a&limit=none",
			status: http.StatusBadRequest},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			req := request{method: tc.method, path: tc.path}
			if tc.body != nil {
				req.body = jsonBody(t, tc.body)
			}

			// act
			resp, body := ts.json(t, req)

			// assert
			assert.Equal(t, tc.status, resp.status)
			assert.Contains(t, resp.header.Get("Content-Type"), "application/json")
			if tc.message != "" {
				assert.Equal(t, tc.message, body["error"])
			}
			assert.NotEmpty(t, body["error"])
		})
	}
}

func TestAPIMalformedBody(t *testing.T) {
	ts := newTestServer(t, testOpts{})

	tests := []struct {
		name   string
		body   io.Reader
		status int
	}{
		{name: "not json", body: strings.NewReader("{oops"), status: http.StatusBadRequest},
		{name: "over the cap", body: strings.NewReader(`{"content":"` + strings.Repeat("x", maxPreviewBody) + `"}`),
			status: http.StatusRequestEntityTooLarge},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, body := ts.json(t, request{method: http.MethodPost, path: "/api/preview", body: tc.body})

			// assert
			assert.Equal(t, tc.status, resp.status)
			assert.NotEmpty(t, body["error"])
		})
	}
}

func TestAPIPreviewMatchesTheViewPage(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	source, _, err := ts.Projects[0].Store.Read("guide.md")
	require.NoError(t, err)

	// act
	resp, body := ts.json(t, request{
		method: http.MethodPost, path: "/api/preview",
		body: jsonBody(t, map[string]string{"content": string(source), "path": "guide.md"}),
	})

	// assert
	rendered, err := ts.Projects[0].Renderer.Render(source, "guide.md")
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, string(rendered.HTML), body["html"])
}

func TestPreviewBodyIsCappedBelowTheSaveBody(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	source := strings.Repeat("[x]: /y\n", maxPreviewBody/8+1)
	require.Greater(t, len(source), maxPreviewBody)
	require.Less(t, len(source), maxJSONBody)

	// act
	preview, previewBody := ts.json(t, request{
		method: http.MethodPost, path: "/api/preview",
		body: jsonBody(t, map[string]string{"content": source, "path": "guide.md"}),
	})
	save, _ := ts.json(t, request{
		method: http.MethodPut, path: "/api/file/big.md",
		body: jsonBody(t, map[string]string{"content": source, "rev": ""}),
	})

	// assert
	assert.Equal(t, http.StatusRequestEntityTooLarge, preview.status)
	assert.Equal(t, "request body is too large", previewBody["error"])
	assert.Equal(t, http.StatusOK, save.status, "a whole document is still saveable")
}

func TestRenderWithDeadline(t *testing.T) {
	tests := []struct {
		name    string
		src     []byte
		limit   int
		timeout time.Duration
		slow    bool
		want    error
	}{
		{name: "renders within the deadline", src: []byte("# hi"), limit: 16, timeout: time.Minute},
		{name: "refuses input over the limit", src: []byte("# far too long"), limit: 4,
			timeout: time.Minute, want: store.ErrTooLarge},
		{name: "gives up on a slow render", src: []byte("# hi"), limit: 16,
			timeout: time.Millisecond, slow: true, want: errRenderTimeout},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			res, err := renderWithDeadline("a.md", tc.src, tc.limit, tc.timeout, func() (string, error) {
				if tc.slow {
					time.Sleep(200 * time.Millisecond)
				}
				return "done", nil
			})

			// assert
			if tc.want != nil {
				assert.ErrorIs(t, err, tc.want)
				assert.Empty(t, res)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, "done", res)
		})
	}
}

func TestRenderTimeoutIsServedAsUnavailable(t *testing.T) {
	// arrange & act
	err := fmt.Errorf("render %q: %w", "a.md", errRenderTimeout)

	// assert
	assert.Equal(t, http.StatusServiceUnavailable, statusOf(err))
	assert.Equal(t, "rendering took too long", errMessage(err))
}

func TestAPISearch(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, body := ts.json(t, request{path: "/api/search?q=widgets&limit=5"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	hits := body["hits"].([]any)
	require.Len(t, hits, 1)
	hit := hits[0].(map[string]any)
	assert.Equal(t, "guide.md", hit["path"])
	assert.Equal(t, "/doc/guide.md?q=widgets", hit["url"],
		"the hit carries the query on, so the page it opens can jump to the match")
	assert.Contains(t, hit["snippet"], "<mark>widgets</mark>")
	assert.NotNil(t, body["elapsed_ms"])
}

func TestAPISearchEmptyQuery(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, body := ts.json(t, request{path: "/api/search?q="})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Empty(t, body["hits"])
}

func TestAPIUpload(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	body, contentType := multipartFile(t, "file", "Скриншот Диска.png", tinyPNG(t))

	// act
	resp, res := ts.json(t, request{
		method: http.MethodPost, path: "/api/upload/notes?doc=notes/cyrillic.md",
		body: body, headers: map[string]string{"Content-Type": contentType},
	})

	// assert
	require.Equal(t, http.StatusCreated, resp.status)
	assert.Equal(t, "notes/cyrillic/skrinshot-diska.png", res["path"])
	assert.Equal(t, "![](cyrillic/skrinshot-diska.png)", res["markdown"])
	assert.True(t, ts.Projects[0].Store.Exists("notes/cyrillic/skrinshot-diska.png"))
}

func TestUploadDir(t *testing.T) {
	tests := []struct {
		name      string
		shared    string
		doc       string
		requested string
		want      string
	}{
		{name: "next to the document", doc: "python/notes.md", requested: "python", want: "python/notes"},
		{name: "document in the root", doc: "index.md", requested: "", want: "index"},
		{name: "no document falls back to the request", requested: "attachments", want: "attachments"},
		{name: "one shared directory", shared: "attachments", doc: "python/notes.md", want: "attachments"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			wb := &Web{Config: Config{UploadDir: tc.shared}}

			// act & assert
			assert.Equal(t, tc.want, wb.uploadDir(tc.doc, tc.requested))
		})
	}
}

func TestAPIUploadIntoOneSharedDirectory(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	ts.UploadDir = "attachments"
	body, contentType := multipartFile(t, "file", "Screen shot.png", tinyPNG(t))

	// act
	resp, res := ts.json(t, request{
		method: http.MethodPost, path: "/api/upload/notes?doc=docs/sub/deep.md",
		body: body, headers: map[string]string{"Content-Type": contentType},
	})

	// assert
	require.Equal(t, http.StatusCreated, resp.status)
	assert.Equal(t, "attachments/screen-shot.png", res["path"])
	assert.Equal(t, "![](../../attachments/screen-shot.png)", res["markdown"])
}

func TestAPIUploadRejects(t *testing.T) {
	ts := newTestServer(t, testOpts{})

	tests := []struct {
		name     string
		field    string
		filename string
		data     []byte
		status   int
	}{
		{name: "no file field", field: "other", filename: "a.png", data: tinyPNG(t), status: http.StatusBadRequest},
		{name: "forbidden extension", field: "file", filename: "payload.exe", data: tinyPNG(t), status: http.StatusBadRequest},
		{name: "content does not match the extension", field: "file", filename: "fake.png",
			data: []byte("#!/bin/sh\nrm -rf /\n"), status: http.StatusBadRequest},
		{name: "over the cap", field: "file", filename: "big.png",
			data: append(tinyPNG(t), make([]byte, 70<<10)...), status: http.StatusRequestEntityTooLarge},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			body, contentType := multipartFile(t, tc.field, tc.filename, tc.data)

			// act
			resp, res := ts.json(t, request{
				method: http.MethodPost, path: "/api/upload/notes?doc=notes/index.md",
				body: body, headers: map[string]string{"Content-Type": contentType},
			})

			// assert
			assert.Equal(t, tc.status, resp.status)
			assert.NotEmpty(t, res["error"])
		})
	}
}

func multipartFile(t *testing.T, field, filename string, data []byte) (io.Reader, string) {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile(field, filename)
	require.NoError(t, err)
	_, err = part.Write(data)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	return &buf, writer.FormDataContentType()
}

func TestReadOnlyRefusesEveryWrite(t *testing.T) {
	ts := newTestServer(t, testOpts{readOnly: true})

	tests := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{name: "save", method: http.MethodPut, path: "/api/file/guide.md", body: map[string]string{"content": "x"}},
		{name: "create", method: http.MethodPost, path: "/api/file/other.md", body: map[string]string{"type": "file"}},
		{name: "delete", method: http.MethodDelete, path: "/api/file/guide.md"},
		{name: "move", method: http.MethodPost, path: "/api/move", body: map[string]string{"from": "guide.md", "to": "x.md"}},
		{name: "upload", method: http.MethodPost, path: "/api/upload/notes"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			req := request{method: tc.method, path: tc.path}
			if tc.body != nil {
				req.body = jsonBody(t, tc.body)
			}

			// act
			resp, body := ts.json(t, req)

			// assert
			assert.Equal(t, http.StatusForbidden, resp.status)
			assert.Equal(t, "read-only mode, writing is disabled", body["error"])
		})
	}
}

// TestReadOnlyIsAnnouncedAndEnforced records where the refusal lives now. The
// editor route used to answer 403 outright; it serves the app like every other
// page, and what a reader is offered comes from /api/me while the api is what
// actually refuses the write.
func TestReadOnlyIsAnnouncedAndEnforced(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{readOnly: true})

	// act
	page, _ := ts.do(t, request{path: "/doc/guide.md"})
	editor, _ := ts.do(t, request{path: "/edit/guide.md"})
	_, me := ts.json(t, request{path: "/api/me"})
	save, saved := ts.json(t, request{
		method: http.MethodPut,
		path:   "/api/file/guide.md",
		body:   jsonBody(t, saveRequest{Content: "nope", Rev: ""}),
	})

	// assert
	assert.Equal(t, http.StatusOK, page.status)
	assert.Equal(t, http.StatusOK, editor.status, "the source is readable, saving is not")
	assert.Equal(t, true, me["read_only"])
	assert.Equal(t, http.StatusForbidden, save.status)
	assert.Contains(t, saved["error"], "read-only")
}

func TestAuthGuardsEverythingButThePublicRoutes(t *testing.T) {
	ts := newTestServer(t, testOpts{withAuth: true})

	tests := []struct {
		name   string
		path   string
		status int
	}{
		{name: "page redirects to login", path: "/doc/guide.md", status: http.StatusFound},
		{name: "root redirects to login", path: "/", status: http.StatusFound},
		{name: "api answers 401", path: "/api/tree", status: http.StatusUnauthorized},
		{name: "login page is public", path: "/login", status: http.StatusOK},
		// the sign-in page carries its own stylesheet, so it has to be readable
		// by someone who has no session yet or the form arrives unstyled
		{name: "assets are public", path: "/static/v1.2.3/login/login.css", status: http.StatusOK},
		{name: "ping is public", path: "/ping", status: http.StatusOK},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, _ := ts.do(t, request{path: tc.path})

			// assert
			assert.Equal(t, tc.status, resp.status)
			if tc.status == http.StatusFound {
				assert.Contains(t, resp.header.Get("Location"), "/login?from=")
			}
		})
	}
}

// bearer is everything an API client sends: no cookie, no CSRF hint, no form.
func bearer(token string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + token}
}

// crossSite adds to headers what a forged write carries: the site hint the
// browser sets by itself and the origin the form came from.
func crossSite(headers map[string]string) map[string]string {
	if headers == nil {
		headers = map[string]string{}
	}
	headers["Sec-Fetch-Site"] = "cross-site"
	headers["Origin"] = "https://evil.example"
	return headers
}

// files is every file under the notes root with its content, so a refused write
// can be shown to have left the corpus alone.
func (ts *testServer) files(t *testing.T) map[string]string {
	t.Helper()
	res := map[string]string{}
	require.NoError(t, filepath.WalkDir(ts.root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, readErr := os.ReadFile(p)
		if readErr != nil {
			return readErr
		}
		rel, relErr := filepath.Rel(ts.root, p)
		if relErr != nil {
			return relErr
		}
		res[filepath.ToSlash(rel)] = string(data)
		return nil
	}))
	return res
}

func TestAPITokenReads(t *testing.T) {
	ts := newTestServer(t, testOpts{withAuth: true})
	guide, _, err := ts.Projects[0].Store.Read("guide.md")
	require.NoError(t, err)

	tests := []struct {
		name  string
		token string
	}{
		{name: "read-write token", token: testToken},
		{name: "read-only token", token: testReadToken},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			tree, treeBody := ts.json(t, request{path: "/api/tree", headers: bearer(tc.token)})
			file, fileBody := ts.json(t, request{path: "/api/file/guide.md", headers: bearer(tc.token)})

			// assert
			assert.Equal(t, http.StatusOK, tree.status)
			assert.NotEmpty(t, treeBody["tree"])
			assert.Equal(t, http.StatusOK, file.status)
			assert.Equal(t, string(guide), fileBody["content"])
			assert.Equal(t, store.Rev(guide), fileBody["rev"])
		})
	}
}

func TestAPITokenWrites(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	const content = "# Written by an agent\n"
	upload, contentType := multipartFile(t, "file", "shot.png", tinyPNG(t))

	// act
	save, saved := ts.json(t, request{method: http.MethodPut, path: "/api/file/agent.md",
		body: jsonBody(t, map[string]string{"content": content}), headers: bearer(testToken)})
	create, _ := ts.json(t, request{method: http.MethodPost, path: "/api/file/inbox",
		body: jsonBody(t, map[string]string{"type": "dir"}), headers: bearer(testToken)})
	move, _ := ts.json(t, request{method: http.MethodPost, path: "/api/move",
		body: jsonBody(t, map[string]string{"from": "agent.md", "to": "inbox/agent.md"}), headers: bearer(testToken)})
	attached, uploaded := ts.json(t, request{method: http.MethodPost, path: "/api/upload/inbox?doc=inbox/agent.md",
		body: upload, headers: map[string]string{"Authorization": "Bearer " + testToken, "Content-Type": contentType}})
	removed, _ := ts.json(t, request{method: http.MethodDelete, path: "/api/file/inbox/agent.md",
		headers: bearer(testToken)})

	// assert
	assert.Equal(t, http.StatusOK, save.status)
	assert.Equal(t, store.Rev([]byte(content)), saved["rev"])
	assert.Equal(t, http.StatusCreated, create.status)
	assert.Equal(t, http.StatusOK, move.status)
	assert.Equal(t, http.StatusCreated, attached.status)
	assert.Equal(t, http.StatusOK, removed.status)
	assert.Contains(t, ts.files(t), uploaded["path"])
	assert.False(t, ts.Projects[0].Store.Exists("inbox/agent.md"))
}

func TestTokenWriteIsNotACrossSiteTarget(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	_, loaded := ts.json(t, request{path: "/api/file/guide.md", headers: bearer(testToken)})

	// act
	resp, _ := ts.json(t, request{method: http.MethodPut, path: "/api/file/guide.md",
		body:    jsonBody(t, map[string]any{"content": "# Guide\n\nrewritten\n", "rev": loaded["rev"]}),
		headers: crossSite(bearer(testToken))})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, "# Guide\n\nrewritten\n", ts.files(t)["guide.md"])
}

func TestCookieWriteIsStillACrossSiteTarget(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	client := ts.login(t)
	before := ts.files(t)

	// act
	resp, body := ts.json(t, request{method: http.MethodPut, path: "/api/file/guide.md",
		body: jsonBody(t, map[string]string{"content": "# forged\n"}), headers: crossSite(nil), client: client})

	// assert
	assert.Equal(t, http.StatusForbidden, resp.status)
	assert.Equal(t, "cross-origin request blocked", body["error"])
	assert.Equal(t, before, ts.files(t))
}

func TestReadOnlyTokenRefusesEveryWrite(t *testing.T) {
	ts := newTestServer(t, testOpts{withAuth: true})

	tests := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{name: "save", method: http.MethodPut, path: "/api/file/guide.md", body: map[string]string{"content": "x"}},
		{name: "create", method: http.MethodPost, path: "/api/file/other.md", body: map[string]string{"type": "file"}},
		{name: "delete", method: http.MethodDelete, path: "/api/file/guide.md"},
		{name: "move", method: http.MethodPost, path: "/api/move", body: map[string]string{"from": "guide.md", "to": "x.md"}},
		{name: "upload", method: http.MethodPost, path: "/api/upload/notes"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			before := ts.files(t)
			req := request{method: tc.method, path: tc.path, headers: bearer(testReadToken)}
			if tc.body != nil {
				req.body = jsonBody(t, tc.body)
			}

			// act
			resp, body := ts.json(t, req)

			// assert
			assert.Equal(t, http.StatusForbidden, resp.status)
			assert.Equal(t, "read-only token, writing is disabled", body["error"])
			assert.Equal(t, before, ts.files(t))
		})
	}
}

func TestReadOnlyServerRefusesAReadWriteToken(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true, readOnly: true})

	// act
	read, _ := ts.json(t, request{path: "/api/tree", headers: bearer(testToken)})
	write, body := ts.json(t, request{method: http.MethodPut, path: "/api/file/guide.md",
		body: jsonBody(t, map[string]string{"content": "x"}), headers: bearer(testToken)})

	// assert
	assert.Equal(t, http.StatusOK, read.status)
	assert.Equal(t, http.StatusForbidden, write.status)
	assert.Equal(t, "read-only mode, writing is disabled", body["error"])
}

func TestUnknownTokenIsRefusedEverywhere(t *testing.T) {
	ts := newTestServer(t, testOpts{withAuth: true})

	tests := []struct {
		name string
		path string
	}{
		{name: "api", path: "/api/tree"},
		{name: "page", path: "/doc/guide.md"},
		{name: "public route", path: "/login"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, body := ts.do(t, request{path: tc.path, headers: bearer("scrawl_nope")})

			// assert
			assert.Equal(t, http.StatusUnauthorized, resp.status)
			assert.Contains(t, body, `{"error":"unauthorized"}`)
			assert.Empty(t, resp.header.Get("Set-Cookie"))
		})
	}
}

func TestLoginFlow(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	client := ts.login(t)

	// act
	page, _ := ts.do(t, request{path: "/doc/guide.md", client: client})
	// the page carries no user name any more, the app asks who it is serving
	_, me := ts.json(t, request{path: "/api/me", client: client})
	loginAgain, _ := ts.do(t, request{path: "/login", client: client})
	out, _ := ts.do(t, request{method: http.MethodPost, path: "/logout", client: client})
	afterLogout, _ := ts.do(t, request{path: "/doc/guide.md", client: client})

	// assert
	assert.Equal(t, http.StatusOK, page.status)
	assert.Equal(t, testUser, me["user"])
	assert.Equal(t, http.StatusFound, loginAgain.status, "an authenticated visitor is sent away from the form")
	assert.Equal(t, http.StatusSeeOther, out.status)
	assert.Equal(t, http.StatusFound, afterLogout.status)
}

func TestLoginRedirectsBackToTheRequestedPage(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	form := url.Values{"username": {testUser}, "password": {testPassword}, "from": {"/doc/notes/cyrillic.md"}}

	// act
	resp, _ := ts.do(t, request{
		method:  http.MethodPost,
		path:    "/login",
		body:    strings.NewReader(form.Encode()),
		headers: map[string]string{"Content-Type": "application/x-www-form-urlencoded"},
	})

	// assert
	assert.Equal(t, http.StatusSeeOther, resp.status)
	assert.Equal(t, "/doc/notes/cyrillic.md", resp.header.Get("Location"))
}

func TestLoginRejectsAndThenThrottles(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	form := url.Values{"username": {testUser}, "password": {"wrong"}}
	attempt := func() (response, string) {
		return ts.do(t, request{
			method:  http.MethodPost,
			path:    "/login",
			body:    strings.NewReader(form.Encode()),
			headers: map[string]string{"Content-Type": "application/x-www-form-urlencoded"},
		})
	}

	// act
	first, body := attempt()
	var last response
	for range 10 {
		last, _ = attempt()
	}

	// assert
	assert.Equal(t, http.StatusUnauthorized, first.status)
	assert.Contains(t, body, "Wrong user name or password")
	assert.Equal(t, http.StatusTooManyRequests, last.status)
	assert.Equal(t, "60", last.header.Get("Retry-After"))
}

func TestLoginRedirectsWhenAuthIsDisabled(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, _ := ts.do(t, request{path: "/login"})

	// assert
	assert.Equal(t, http.StatusFound, resp.status)
	assert.Equal(t, "/", resp.header.Get("Location"))
}

func TestCSRFBlocksCrossSiteWrites(t *testing.T) {
	ts := newTestServer(t, testOpts{})

	tests := []struct {
		name   string
		method string
		path   string
	}{
		{name: "save", method: http.MethodPut, path: "/api/file/guide.md"},
		{name: "create", method: http.MethodPost, path: "/api/file/other.md"},
		{name: "delete", method: http.MethodDelete, path: "/api/file/guide.md"},
		{name: "move", method: http.MethodPost, path: "/api/move"},
		{name: "login", method: http.MethodPost, path: "/login"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, _ := ts.do(t, request{
				method:  tc.method,
				path:    tc.path,
				body:    jsonBody(t, map[string]string{"content": "x"}),
				headers: crossSite(nil),
			})

			// assert
			assert.Equal(t, http.StatusForbidden, resp.status)
		})
	}
}

func TestCSRFAllowsSameOriginWrites(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, _ := ts.json(t, request{
		method: http.MethodPost, path: "/api/file/same-origin.md",
		body:    jsonBody(t, map[string]string{"type": "file"}),
		headers: map[string]string{"Sec-Fetch-Site": "same-origin"},
	})

	// assert
	assert.Equal(t, http.StatusCreated, resp.status)
}

func TestRenderCacheIsUsedAndInvalidated(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	rev := revOf(t, ts, "guide.md")
	ts.pages().put(testProject, "guide.md", rev, render.Result{HTML: "<p>served from the cache</p>", Title: "Cached"})

	// act
	cached, cachedBody := ts.json(t, request{path: "/api/page/guide.md"})
	ts.Invalidate(testProject, "guide.md")
	fresh, freshBody := ts.json(t, request{path: "/api/page/guide.md"})

	// assert
	assert.Equal(t, http.StatusOK, cached.status)
	assert.Contains(t, cachedBody["html"], "served from the cache")
	assert.Equal(t, http.StatusOK, fresh.status)
	assert.NotContains(t, freshBody["html"], "served from the cache")
	assert.Contains(t, freshBody["html"], "widgets and gadgets")
}

func TestRenderCacheFillsOnTheFirstRequest(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	require.Equal(t, 0, ts.pages().len())

	// act
	// the shell renders no markdown, so the cache is filled by the route that
	// hands the document over
	ts.do(t, request{path: "/api/page/guide.md"})
	ts.do(t, request{path: "/api/page/guide.md"})

	// assert
	assert.Equal(t, 1, ts.pages().len())
	_, ok := ts.pages().get(testProject, "guide.md", revOf(t, ts, "guide.md"))
	assert.True(t, ok)
}

func revOf(t *testing.T, ts *testServer, contentPath string) string {
	t.Helper()
	data, _, err := ts.Projects[0].Store.Read(contentPath)
	require.NoError(t, err)
	return store.Rev(data)
}

// TestLoginTemplateExecutes renders the one page the server still builds
// itself, so a field the template needs and the handler does not fill shows up
// here instead of in a browser. Every other page is the app now.
func TestLoginTemplateExecutes(t *testing.T) {
	wb := &Web{Config: Config{Title: "Test Notes", Version: "v1"}}
	require.NoError(t, wb.parseTemplates())

	tests := []struct {
		name string
		data LoginPage
	}{
		{name: "plain", data: LoginPage{SiteTitle: "Test Notes", Version: "v1", Theme: "auto"}},
		{name: "refused", data: LoginPage{SiteTitle: "Test Notes", Version: "v1", Theme: "dark",
			Error: "Wrong user name or password", From: "/doc/guide.md"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			var buf bytes.Buffer

			// act
			err := wb.templates.ExecuteTemplate(&buf, "login.html", tc.data)

			// assert
			require.NoError(t, err)
			assert.NotEmpty(t, buf.String())
		})
	}
}

// TestPageLinksEscapeAwkwardPaths guards the templates that build a link out of
// a content path. A file name may hold anything the filesystem allows, and a
// question mark pasted into an href would turn the rest of the name into a
// query string.
func TestPageLinksEscapeAwkwardPaths(t *testing.T) {
	// arrange
	const awkward = "notes/что? да.md"
	const escaped = "notes/%D1%87%D1%82%D0%BE%3F%20%D0%B4%D0%B0.md"

	tests := []struct {
		name string
		got  string
		want string
	}{
		{name: "document", got: contentURL(awkward), want: "/doc/" + escaped},
		{name: "editor", got: editURL(awkward), want: "/edit/" + escaped},
		{name: "history", got: historyURL(awkward), want: "/history/" + escaped},
		{name: "directory", got: dirURL("notes/что? да"), want: "/doc/notes/%D1%87%D1%82%D0%BE%3F%20%D0%B4%D0%B0/"},
		// a hit carries the query on, which is what lights up the match on the
		// page it opens, so the link is a path and a query together
		{name: "search hit", got: searchURL(awkward, "да"), want: "/doc/" + escaped + "?q=%D0%B4%D0%B0"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act & assert
			assert.Equal(t, tc.want, tc.got)
		})
	}
}

// TestNoInlineScripts locks the assumption the content security policy rests
// on: an inline block would be blocked by "script-src 'self'", and the
// templates carry no field to render a nonce into.
func TestNoInlineScripts(t *testing.T) {
	// arrange
	names, err := fs.Glob(content, "templates/*.html")
	require.NoError(t, err)
	require.NotEmpty(t, names)
	openTag := regexp.MustCompile(`<script[^>]*>`)

	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			// act
			data, readErr := fs.ReadFile(content, name)
			require.NoError(t, readErr)

			// assert
			for _, tag := range openTag.FindAllString(string(data), -1) {
				assert.Contains(t, tag, "src=", "inline script in %s", name)
			}
		})
	}
}

// TestStyleNonceIsFreshAndScriptSrcStaysStrict locks the one relaxation the
// policy carries. Mantine writes style attributes, which a nonce can never
// authorize, so style-src-attr takes 'unsafe-inline' while style-src-elem stays
// on a nonce. A nonce reused across responses authorizes nothing, and neither
// relaxation may ever reach script-src.
func TestStyleNonceIsFreshAndScriptSrcStaysStrict(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	nonce := regexp.MustCompile(`style-src-elem 'self' 'nonce-([A-Za-z0-9_-]+)'`)

	// act
	first, _ := ts.do(t, request{path: "/"})
	second, _ := ts.do(t, request{path: "/"})

	// assert
	firstNonce := nonce.FindStringSubmatch(first.header.Get("Content-Security-Policy"))
	secondNonce := nonce.FindStringSubmatch(second.header.Get("Content-Security-Policy"))
	require.Len(t, firstNonce, 2)
	require.Len(t, secondNonce, 2)
	assert.NotEqual(t, firstNonce[1], secondNonce[1])

	policy := first.header.Get("Content-Security-Policy")
	assert.Contains(t, policy, "style-src-attr 'unsafe-inline'")
	assert.Contains(t, policy, "script-src 'self'")
	assert.NotContains(t, policy, "script-src 'self' 'unsafe-inline'")
	assert.NotContains(t, policy, "script-src-elem")
}

// TestStoreErrorMapping locks the table the store package handed over: every
// sentinel has one status and one message, and neither ever quotes a path.
func TestStoreErrorMapping(t *testing.T) {
	tests := []struct {
		name    string
		err     error
		status  int
		message string
	}{
		{name: "no error", status: http.StatusOK, message: "internal error"},
		{name: "forbidden", err: store.ErrForbidden, status: http.StatusBadRequest, message: "forbidden"},
		{name: "is a directory", err: store.ErrIsDir, status: http.StatusBadRequest, message: "path is a directory"},
		{name: "not found", err: store.ErrNotFound, status: http.StatusNotFound, message: "not found"},
		{name: "conflict", err: &store.ConflictError{Path: "a.md", CurrentRev: "sha256:x"},
			status: http.StatusPreconditionFailed, message: "conflict"},
		{name: "exists", err: store.ErrExists, status: http.StatusConflict, message: "already exists"},
		{name: "not empty", err: store.ErrNotEmpty, status: http.StatusConflict, message: "directory is not empty"},
		{name: "read only", err: store.ErrReadOnly, status: http.StatusForbidden,
			message: "read-only mode, writing is disabled"},
		{name: "permission denied", err: store.ErrPermission, status: http.StatusForbidden,
			message: permissionMessage},
		{name: "too large", err: store.ErrTooLarge, status: http.StatusRequestEntityTooLarge,
			message: "file is too large"},
		{name: "anything else", err: errors.New("disk on fire"), status: http.StatusInternalServerError,
			message: "internal error"},
		{name: "wrapped sentinel", err: fmt.Errorf("read %q: %w", "/srv/notes/a.md", store.ErrNotFound),
			status: http.StatusNotFound, message: "not found"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act & assert
			assert.Equal(t, tc.status, statusOf(tc.err))
			assert.Equal(t, tc.message, errMessage(tc.err))
			assert.NotContains(t, errMessage(tc.err), "/srv/notes")
		})
	}
}

func TestStatusMessage(t *testing.T) {
	tests := []struct {
		name     string
		status   int
		expected string
	}{
		{name: "bad request", status: http.StatusBadRequest, expected: "That path does not look right"},
		{name: "forbidden", status: http.StatusForbidden, expected: "This is not allowed"},
		{name: "not found", status: http.StatusNotFound, expected: "This page does not exist"},
		{name: "too large", status: http.StatusRequestEntityTooLarge, expected: "That is too large"},
		{name: "throttled", status: http.StatusTooManyRequests, expected: "Too many attempts"},
		{name: "anything else", status: http.StatusInternalServerError, expected: "Something went wrong"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act & assert
			assert.Equal(t, tc.expected, statusMessage(tc.status))
		})
	}
}

func TestContentURL(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		expected string
	}{
		{name: "markdown", path: "notes/page.md", expected: "/doc/notes/page.md"},
		{name: "uppercase markdown", path: "notes/PAGE.MD", expected: "/doc/notes/PAGE.MD"},
		{name: "attachment", path: "images/logo.png", expected: "/raw/images/logo.png"},
		{name: "cyrillic", path: "заметки.md", expected: "/doc/%D0%B7%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B8.md"},
		{name: "space", path: "my file.png", expected: "/raw/my%20file.png"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act & assert
			assert.Equal(t, tc.expected, contentURL(tc.path))
		})
	}
}

func TestBreadcrumbs(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		expected []Crumb
	}{
		{name: "root", path: "", expected: []Crumb{{Name: "Home"}}},
		{name: "top level file", path: "guide.md",
			expected: []Crumb{{Name: "Home", URL: "/"}, {Name: "guide"}}},
		{name: "nested file", path: "notes/deep/nested.md", expected: []Crumb{
			{Name: "Home", URL: "/"}, {Name: "notes", URL: "/doc/notes/"},
			{Name: "deep", URL: "/doc/notes/deep/"}, {Name: "nested"},
		}},
		{name: "cyrillic segment", path: "заметки/файл.md", expected: []Crumb{
			{Name: "Home", URL: "/"}, {Name: "заметки", URL: "/doc/%D0%B7%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B8/"},
			{Name: "файл"},
		}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			crumbs := breadcrumbs(tc.path)

			// assert
			assert.Equal(t, tc.expected, crumbs)
		})
	}
}

func TestRelativeLink(t *testing.T) {
	tests := []struct {
		name     string
		doc      string
		target   string
		expected string
	}{
		{name: "same directory", doc: "notes/page.md", target: "notes/img.png", expected: "img.png"},
		{name: "sibling directory", doc: "notes/page.md", target: "images/img.png", expected: "../images/img.png"},
		{name: "document at the root", doc: "page.md", target: "images/img.png", expected: "images/img.png"},
		{name: "no document given", doc: "", target: "images/img.png", expected: "images/img.png"},
		{name: "two levels up", doc: "a/b/c.md", target: "images/img.png", expected: "../../images/img.png"},
		{name: "shared prefix", doc: "a/b/c.md", target: "a/img.png", expected: "../img.png"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			link := relativeLink(tc.doc, tc.target)

			// assert
			assert.Equal(t, tc.expected, link)
		})
	}
}

func TestThemeOf(t *testing.T) {
	tests := []struct {
		name     string
		cookie   string
		expected string
	}{
		{name: "no cookie", expected: "auto"},
		{name: "dark", cookie: "dark", expected: "dark"},
		{name: "light", cookie: "light", expected: "light"},
		{name: "garbage", cookie: "neon", expected: "auto"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			r := httptest.NewRequest(http.MethodGet, "/", http.NoBody)
			if tc.cookie != "" {
				r.AddCookie(&http.Cookie{Name: themeCookie, Value: tc.cookie})
			}

			// act & assert
			assert.Equal(t, tc.expected, themeOf(r))
		})
	}
}

func TestThemeCookieReachesTheDocument(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	client := noRedirectClient(t)
	base, err := url.Parse(ts.url)
	require.NoError(t, err)
	client.Jar.SetCookies(base, []*http.Cookie{{Name: themeCookie, Value: "dark"}})

	// act
	_, body := ts.do(t, request{path: "/", client: client})

	// assert
	assert.Contains(t, body, `data-mantine-color-scheme="dark"`)
}

func TestWebRunEmptyListenAddr(t *testing.T) {
	// arrange
	wb := &Web{}

	// act
	err := wb.Run(t.Context())

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "listen address")
}

func TestWebRunGracefulShutdown(t *testing.T) {
	// arrange
	addr := fmt.Sprintf("127.0.0.1:%d", freePort(t))
	wb := &Web{Projects: []*Project{{Name: testProject}}, Config: Config{
		ListenAddr:        addr,
		Version:           "test",
		ReadHeaderTimeout: time.Second,
		ReadTimeout:       5 * time.Second,
		WriteTimeout:      5 * time.Second,
		IdleTimeout:       5 * time.Second,
		ShutdownTimeout:   2 * time.Second,
	}}

	ctx, cancel := context.WithCancel(t.Context())
	errCh := make(chan error, 1)
	go func() { errCh <- wb.Run(ctx) }()

	// act
	status := waitForPing(t, "http://"+addr+"/ping")
	cancel()

	// assert
	assert.Equal(t, http.StatusOK, status)
	select {
	case err := <-errCh:
		assert.NoError(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("server did not stop in time")
	}
}

func TestWebRunBusyPort(t *testing.T) {
	// arrange
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()

	wb := &Web{Projects: []*Project{{Name: testProject}}, Config: Config{ListenAddr: ln.Addr().String()}}

	// act
	err = wb.Run(t.Context())

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "server failed")
}

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	port := ln.Addr().(*net.TCPAddr).Port
	require.NoError(t, ln.Close())
	return port
}

func waitForPing(t *testing.T, addr string) int {
	t.Helper()
	var lastErr error
	for range 100 {
		req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, addr, http.NoBody)
		require.NoError(t, err)
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			status := resp.StatusCode
			require.NoError(t, resp.Body.Close())
			return status
		}
		lastErr = err
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("server never answered on %s: %v", addr, lastErr)
	return 0
}
