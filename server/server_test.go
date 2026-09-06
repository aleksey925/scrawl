package server

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
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

	"github.com/aleksey925/mdserver/auth"
	"github.com/aleksey925/mdserver/render"
	"github.com/aleksey925/mdserver/search"
	"github.com/aleksey925/mdserver/store"
)

const testUser = "bob"

const testPassword = "s3cret"

// testServer is a whole app over a temporary knowledge base.
type testServer struct {
	*Web
	url  string
	root string
}

type testOpts struct {
	readOnly bool
	withAuth bool
}

func newTestServer(t *testing.T, opts testOpts) *testServer {
	t.Helper()
	root := testKB(t)

	kb, err := store.New(store.Config{Root: root, ReadOnly: opts.readOnly, Rescan: -1})
	require.NoError(t, err)
	t.Cleanup(func() { _ = kb.Close() })

	index := search.New()
	require.NoError(t, kb.Walk(func(fi store.FileInfo, data []byte) error {
		index.Set(fi.Path, data)
		return nil
	}))

	users := ""
	if opts.withAuth {
		users = testUser + ":" + testPassword
	}
	svc, err := auth.NewService(auth.Config{
		Users:    users,
		Secret:   "test-signing-secret",
		Disabled: !opts.withAuth,
		TTL:      time.Hour,
	})
	require.NoError(t, err)

	wb := &Web{
		Config: Config{
			Title:        "Test KB",
			Version:      "v1.2.3",
			ReadOnly:     opts.readOnly,
			MaxUpload:    64 << 10,
			AuthDisabled: !opts.withAuth,
		},
		Store:    kb,
		Renderer: render.New(render.Options{LinkExists: kb.Exists}),
		Index:    index,
		Auth:     svc,
	}

	router, err := wb.router()
	require.NoError(t, err)
	ts := httptest.NewServer(router)
	t.Cleanup(ts.Close)

	return &testServer{Web: wb, url: ts.URL, root: root}
}

// testKB writes a small knowledge base covering every shape the handlers have
// to tell apart: a root index, a directory with its own index, a directory with
// only a readme, a non-markdown attachment and a Cyrillic document.
func testKB(t *testing.T) string {
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

// request is one call against the test server.
type request struct {
	method  string
	path    string
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

	httpReq, err := http.NewRequestWithContext(t.Context(), req.method, ts.url+req.path, body)
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
		{name: "stylesheet", path: "/static/v1.2.3/css/style.css", status: http.StatusOK, contentType: "text/css"},
		{name: "generated chroma css", path: "/static/v1.2.3/css/chroma.css", status: http.StatusOK, contentType: "text/css"},
		{name: "module", path: "/static/v1.2.3/js/app.js", status: http.StatusOK},
		{name: "favicon", path: "/static/v1.2.3/favicon.svg", status: http.StatusOK, contentType: "image/svg+xml"},
		{name: "missing asset", path: "/static/v1.2.3/css/nope.css", status: http.StatusNotFound},
		{name: "empty asset path", path: "/static/v1.2.3/", status: http.StatusNotFound},
		{name: "templates are not assets", path: "/static/v1.2.3/../templates/base.html", status: http.StatusMovedPermanently},
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
		{name: "rendered page", path: "/", encoding: "gzip"},
		{name: "stylesheet", path: "/static/v1.2.3/css/style.css", encoding: "gzip"},
		{name: "generated chroma css", path: "/static/v1.2.3/css/chroma.css", encoding: "gzip"},
		{name: "module", path: "/static/v1.2.3/js/app.js", encoding: "gzip"},
		{name: "vendored bundle", path: "/static/v1.2.3/vendor/mermaid/mermaid.min.js", encoding: "gzip"},
		{name: "favicon", path: "/static/v1.2.3/favicon.svg", encoding: "gzip"},
		{name: "json api", path: "/api/tree", encoding: "gzip"},
		{name: "raw markdown", path: "/raw/index.md", encoding: "gzip"},
		{name: "vendored font", path: "/static/v1.2.3/vendor/katex/fonts/KaTeX_Main-Regular.woff2"},
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
	assert.Equal(t, plain, string(decoded))
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
		{name: "a document path ending in ping", path: "/p/notes/ping", status: http.StatusFound},
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
	assert.Equal(t, contentSecurityPolicy, resp.header.Get("Content-Security-Policy"))
	assert.Equal(t, "mdserver", resp.header.Get("App-Name"))
	assert.Equal(t, "v1.2.3", resp.header.Get("App-Version"))
}

func TestHTMLRoutes(t *testing.T) {
	ts := newTestServer(t, testOpts{})

	tests := []struct {
		name     string
		path     string
		status   int
		contains []string
		location string
	}{
		{name: "root index", path: "/", status: http.StatusOK, contains: []string{"Welcome", "Home - Test KB"}},
		{name: "document", path: "/p/guide.md", status: http.StatusOK, contains: []string{"widgets and gadgets", `id="doc"`}},
		{name: "document outline", path: "/p/guide.md", status: http.StatusOK, contains: []string{`class="toc"`, "#setup"}},
		{name: "directory with index", path: "/p/notes/", status: http.StatusOK, contains: []string{"the notes index"}},
		{name: "directory with readme", path: "/p/docs/", status: http.StatusOK,
			contains: []string{"the intro above the listing", "page", `href="/p/docs/sub/"`}},
		{name: "directory listing", path: "/p/images/", status: http.StatusOK, contains: []string{"logo.png", "1 item"}},
		{name: "cyrillic anchors", path: "/p/notes/cyrillic.md", status: http.StatusOK, contains: []string{"общее"}},
		{name: "missing document", path: "/p/nope.md", status: http.StatusNotFound, contains: []string{"does not exist yet", "/edit/nope.md"}},
		{name: "missing directory", path: "/p/nope/", status: http.StatusNotFound, contains: []string{"error-code"}},
		{name: "attachment redirects to raw", path: "/p/snippet.py", status: http.StatusFound, location: "/raw/snippet.py"},
		{name: "editor of an existing page", path: "/edit/guide.md", status: http.StatusOK, contains: []string{"# Guide", `data-new="0"`}},
		{name: "editor of a new page", path: "/edit/fresh.md", status: http.StatusOK, contains: []string{`data-new="1"`}},
		{name: "editor refuses a non markdown path", path: "/edit/snippet.py", status: http.StatusBadRequest},
		{name: "search results", path: "/search?q=widgets", status: http.StatusOK, contains: []string{"1 result", "<mark>widgets</mark>"}},
		{name: "empty search", path: "/search", status: http.StatusOK, contains: []string{"Search every page"}},
		{name: "unknown route", path: "/nothing", status: http.StatusNotFound},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, body := ts.do(t, request{path: tc.path})

			// assert
			assert.Equal(t, tc.status, resp.status)
			for _, want := range tc.contains {
				assert.Contains(t, body, want)
			}
			if tc.location != "" {
				assert.Equal(t, tc.location, resp.header.Get("Location"))
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
	_, flat := ts.do(t, request{path: "/p/flat.md"})
	_, listed := ts.do(t, request{path: "/p/guide.md"})

	// assert
	assert.NotContains(t, flat, `id="toc-rail"`, "three h1 headings render no outline entry")
	assert.NotContains(t, flat, "toc-pill")
	assert.Contains(t, listed, `id="toc-rail"`)
	assert.Contains(t, listed, "toc-pill")
}

func TestOnlyDotMDIsADocument(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	view, _ := ts.do(t, request{path: "/p/long.markdown"})
	edit, _ := ts.do(t, request{path: "/edit/long.markdown"})
	_, linking := ts.do(t, request{path: "/p/links.md"})
	_, found := ts.json(t, request{path: "/api/search?q=kumquat"})

	// assert
	assert.Equal(t, http.StatusFound, view.status)
	assert.Equal(t, "/raw/long.markdown", view.header.Get("Location"))
	assert.Equal(t, http.StatusBadRequest, edit.status)
	assert.Contains(t, linking, `href="/raw/long.markdown"`)
	assert.Empty(t, found["hits"])

	paths := []string{}
	for _, node := range ts.treeNodes("") {
		paths = append(paths, node.Path)
	}
	assert.Equal(t, []string{"docs", "notes", "guide.md", "index.md", "links.md"}, paths)
}

func TestViewNeverLeaksTheFilesystemPath(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	_, page := ts.do(t, request{path: "/p/nope/"})
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
	assert.Equal(t, []string{"docs", "notes", "guide.md", "index.md", "links.md"}, names,
		"the tree indexes documents, not every file")
}

func TestTreeSkipsFoldersWithoutDocuments(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	require.NoError(t, os.MkdirAll(filepath.Join(ts.root, "attachments"), 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(ts.root, "attachments", "shot.png"), tinyPNG(t), 0o600))
	require.NoError(t, os.MkdirAll(filepath.Join(ts.root, "empty"), 0o750))

	// act
	nodes := ts.treeNodes("")

	// assert
	paths := []string{}
	for _, node := range nodes {
		paths = append(paths, node.Path)
	}
	assert.Equal(t, []string{"docs", "notes", "guide.md", "index.md", "links.md"}, paths)
}

func TestTreeDirectoriesCarryTheirPageURL(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	nodes := ts.treeNodes("docs/page.md")

	// assert
	docs := nodes[0]
	require.True(t, docs.IsDir)
	assert.Equal(t, "/p/docs/", docs.URL)
	assert.True(t, docs.Active)
	assert.False(t, docs.Current, "the current page is the document, not the folder holding it")
	assert.Equal(t, "/p/docs/sub/", docs.Children[0].URL)
}

func TestTreeMarksTheFolderBeingViewed(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	nodes := ts.treeNodes("docs/sub")

	// assert
	docs := nodes[0]
	require.Equal(t, "docs", docs.Path)
	assert.True(t, docs.Active)
	assert.False(t, docs.Current)
	assert.True(t, docs.Children[0].Current)
	assert.True(t, docs.Children[0].Active, "the current folder is also on its own path")
}

func TestFolderPageHighlightsItsRow(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, body := ts.do(t, request{path: "/p/docs/sub/"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Contains(t, body, `<summary class="tree-row is-current">`)
	assert.Contains(t, body, `href="/p/docs/sub/" aria-current="page"`)
}

func TestAPIFileGet(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, body := ts.json(t, request{path: "/api/file/guide.md"})

	// assert
	source, _, err := ts.Store.Read("guide.md")
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
	assert.Equal(t, http.StatusNoContent, removed.status)
	assert.False(t, ts.Store.Exists("new/renamed.md"))
}

func TestAPIFileSaveConflict(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	original, _, err := ts.Store.Read("guide.md")
	require.NoError(t, err)
	_, err = ts.Store.Write("guide.md", []byte("# Changed on disk\n"), store.Rev(original))
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
	current, _, err := ts.Store.Read("guide.md")
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
	require.Empty(t, ts.Index.Search("kumquat", 5))

	// act
	resp, _ := ts.json(t, request{
		method: http.MethodPut, path: "/api/file/guide.md",
		body: jsonBody(t, map[string]string{"content": "# Guide\n\nkumquat\n", "rev": revOf(t, ts, "guide.md")}),
	})

	// assert
	require.Equal(t, http.StatusOK, resp.status)
	hits := ts.Index.Search("kumquat", 5)
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
	source, _, err := ts.Store.Read("guide.md")
	require.NoError(t, err)

	// act
	resp, body := ts.json(t, request{
		method: http.MethodPost, path: "/api/preview",
		body: jsonBody(t, map[string]string{"content": string(source), "path": "guide.md"}),
	})

	// assert
	rendered, err := ts.Renderer.Render(source, "guide.md")
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
	assert.Equal(t, "/p/guide.md", hit["url"])
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
	assert.True(t, ts.Store.Exists("notes/cyrillic/skrinshot-diska.png"))
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

func TestReadOnlyPages(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{readOnly: true})

	// act
	view, viewBody := ts.do(t, request{path: "/p/guide.md"})
	editor, _ := ts.do(t, request{path: "/edit/guide.md"})

	// assert
	assert.Equal(t, http.StatusOK, view.status)
	assert.NotContains(t, viewBody, "Edit this page")
	assert.NotContains(t, viewBody, "data-new-page")
	assert.Equal(t, http.StatusForbidden, editor.status)
}

func TestAuthGuardsEverythingButThePublicRoutes(t *testing.T) {
	ts := newTestServer(t, testOpts{withAuth: true})

	tests := []struct {
		name   string
		path   string
		status int
	}{
		{name: "page redirects to login", path: "/p/guide.md", status: http.StatusFound},
		{name: "root redirects to login", path: "/", status: http.StatusFound},
		{name: "api answers 401", path: "/api/tree", status: http.StatusUnauthorized},
		{name: "login page is public", path: "/login", status: http.StatusOK},
		{name: "assets are public", path: "/static/v1.2.3/css/style.css", status: http.StatusOK},
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

func TestLoginFlow(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	client := ts.login(t)

	// act
	page, body := ts.do(t, request{path: "/p/guide.md", client: client})
	loginAgain, _ := ts.do(t, request{path: "/login", client: client})
	out, _ := ts.do(t, request{method: http.MethodPost, path: "/logout", client: client})
	afterLogout, _ := ts.do(t, request{path: "/p/guide.md", client: client})

	// assert
	assert.Equal(t, http.StatusOK, page.status)
	assert.Contains(t, body, testUser)
	assert.Equal(t, http.StatusFound, loginAgain.status, "an authenticated visitor is sent away from the form")
	assert.Equal(t, http.StatusSeeOther, out.status)
	assert.Equal(t, http.StatusFound, afterLogout.status)
}

func TestLoginRedirectsBackToTheRequestedPage(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	form := url.Values{"username": {testUser}, "password": {testPassword}, "from": {"/p/notes/cyrillic.md"}}

	// act
	resp, _ := ts.do(t, request{
		method:  http.MethodPost,
		path:    "/login",
		body:    strings.NewReader(form.Encode()),
		headers: map[string]string{"Content-Type": "application/x-www-form-urlencoded"},
	})

	// assert
	assert.Equal(t, http.StatusSeeOther, resp.status)
	assert.Equal(t, "/p/notes/cyrillic.md", resp.header.Get("Location"))
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
				headers: map[string]string{"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example"},
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
	ts.pages().put("guide.md", rev, render.Result{HTML: "<p>served from the cache</p>", Title: "Cached"})

	// act
	cached, cachedBody := ts.do(t, request{path: "/p/guide.md"})
	ts.Invalidate("guide.md")
	fresh, freshBody := ts.do(t, request{path: "/p/guide.md"})

	// assert
	assert.Equal(t, http.StatusOK, cached.status)
	assert.Contains(t, cachedBody, "served from the cache")
	assert.Equal(t, http.StatusOK, fresh.status)
	assert.NotContains(t, freshBody, "served from the cache")
	assert.Contains(t, freshBody, "widgets and gadgets")
}

func TestRenderCacheFillsOnTheFirstRequest(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	require.Equal(t, 0, ts.pages().len())

	// act
	ts.do(t, request{path: "/p/guide.md"})
	ts.do(t, request{path: "/p/guide.md"})

	// assert
	assert.Equal(t, 1, ts.pages().len())
	_, ok := ts.pages().get("guide.md", revOf(t, ts, "guide.md"))
	assert.True(t, ok)
}

func revOf(t *testing.T, ts *testServer, contentPath string) string {
	t.Helper()
	data, _, err := ts.Store.Read(contentPath)
	require.NoError(t, err)
	return store.Rev(data)
}

// TestEveryTemplateExecutes renders each page with data shaped like the real
// thing, so a field a template needs and a handler does not fill shows up here
// instead of in a browser.
func TestEveryTemplateExecutes(t *testing.T) {
	wb := &Web{Config: Config{Title: "Test KB", Version: "v1"}}
	require.NoError(t, wb.parseTemplates())

	base := Base{
		SiteTitle: "Test KB",
		Title:     "Guide",
		User:      "bob",
		AuthOn:    true,
		Version:   "v1",
		Theme:     "dark",
		Tree: []TreeNode{
			{Name: "notes", Path: "notes", IsDir: true, Active: true, Children: []TreeNode{
				{Name: "cyrillic", Path: "notes/cyrillic.md", URL: "/p/notes/cyrillic.md", Current: true},
			}},
			{Name: "guide", Path: "guide.md", URL: "/p/guide.md"},
		},
		Breadcrumbs: []Crumb{{Name: "Home", URL: "/"}, {Name: "notes", URL: "/p/notes/"}, {Name: "cyrillic"}},
		CurrentPath: "notes/cyrillic.md",
	}

	tests := []struct {
		name string
		data any
	}{
		{name: "view.html", data: ViewPage{
			Base: base, Content: "<p>body</p>", Rev: "sha256:abc", ModTime: time.Now(),
			EditURL: "/edit/notes/cyrillic.md",
			TOC: []render.Heading{
				{Level: 2, Text: "Общее", ID: "общее"},
				{Level: 3, Text: "Detail", ID: "detail"},
				{Level: 2, Text: "Links", ID: "links"},
			},
		}},
		{name: "view.html missing", data: ViewPage{Base: base, EditURL: "/edit/nope.md", Missing: true}},
		{name: "dir.html", data: DirPage{
			Base:      base,
			Entries:   []DirEntry{{Name: "deep", URL: "/p/notes/deep/", IsDir: true, ModTime: time.Now()}},
			Readme:    template.HTML("<p>intro</p>"),
			HasReadme: true,
		}},
		{name: "dir.html empty", data: DirPage{Base: base}},
		{name: "edit.html", data: EditPage{Base: base, Content: "# Hi", Rev: "sha256:abc", ViewURL: "/p/x.md"}},
		{name: "edit.html new", data: EditPage{Base: base, ViewURL: "/p/x.md", IsNew: true}},
		{name: "search.html plain string snippet", data: SearchPage{
			Base: base, Query: "raw",
			Hits: []search.Hit{{Path: "a.md", Title: "A", Snippet: template.HTML("<mark>raw</mark>")}},
		}},
		{name: "search.html", data: SearchPage{
			Base: base, Query: "поиск", Elapsed: 4 * time.Millisecond,
			Hits: []search.Hit{{Path: "notes/cyrillic.md", Title: "Заметки",
				Snippet: template.HTML("текст про <mark>поиск</mark>"), Score: 3.5, Line: 5}},
		}},
		{name: "search.html empty", data: SearchPage{Base: base}},
		{name: "error.html", data: ErrorPage{Base: base, Code: 404, Message: "This page does not exist"}},
		{name: "login.html", data: LoginPage{SiteTitle: "Test KB", Version: "v1", Theme: "auto",
			Error: "Wrong user name or password", From: "/p/guide.md"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			name, _, _ := strings.Cut(tc.name, " ")
			var buf bytes.Buffer

			// act
			err := wb.templates.ExecuteTemplate(&buf, name, tc.data)

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
	ts := newTestServer(t, testOpts{})
	const awkward = "notes/что? да.md"

	tests := []struct {
		name string
		tmpl string
		data any
		want string
	}{
		{name: "search hit", tmpl: "search.html", want: "/p/notes/%D1%87%D1%82%D0%BE%3F%20%D0%B4%D0%B0.md",
			data: SearchPage{Base: ts.base(newRequest(t), "Search", ""), Query: "да",
				Hits: []search.Hit{{Path: awkward, Title: "Что"}}}},
		{name: "create this page", tmpl: "error.html", want: "/edit/notes/%D1%87%D1%82%D0%BE%3F%20%D0%B4%D0%B0.md",
			data: ErrorPage{Base: ts.base(newRequest(t), "Not found", awkward), Code: 404, Message: "gone"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			var buf bytes.Buffer
			require.NoError(t, ts.templates.ExecuteTemplate(&buf, tc.tmpl, tc.data))

			// assert
			assert.Contains(t, buf.String(), `href="`+tc.want+`"`)
		})
	}
}

func newRequest(t *testing.T) *http.Request {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "/", http.NoBody)
	require.NoError(t, err)
	return req
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

// TestEmptyStyleHashPermitsNothing checks the one relaxation in the policy: the
// hash is the digest of the empty string, so the only inline style it lets past
// is style="", and 'unsafe-inline' never sneaks in beside it.
func TestEmptyStyleHashPermitsNothing(t *testing.T) {
	// act
	sum := sha256.Sum256(nil)

	// assert
	assert.Equal(t, "'sha256-"+base64.StdEncoding.EncodeToString(sum[:])+"'", emptyStyleHash)
	assert.Contains(t, contentSecurityPolicy, "style-src 'self' 'unsafe-hashes' "+emptyStyleHash+";")
	assert.NotContains(t, contentSecurityPolicy, "'unsafe-inline'")
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
		{name: "wrapped sentinel", err: fmt.Errorf("read %q: %w", "/srv/kb/a.md", store.ErrNotFound),
			status: http.StatusNotFound, message: "not found"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act & assert
			assert.Equal(t, tc.status, statusOf(tc.err))
			assert.Equal(t, tc.message, errMessage(tc.err))
			assert.NotContains(t, errMessage(tc.err), "/srv/kb")
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
		{name: "markdown", path: "notes/page.md", expected: "/p/notes/page.md"},
		{name: "uppercase markdown", path: "notes/PAGE.MD", expected: "/p/notes/PAGE.MD"},
		{name: "attachment", path: "images/logo.png", expected: "/raw/images/logo.png"},
		{name: "cyrillic", path: "заметки.md", expected: "/p/%D0%B7%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B8.md"},
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
			{Name: "Home", URL: "/"}, {Name: "notes", URL: "/p/notes/"},
			{Name: "deep", URL: "/p/notes/deep/"}, {Name: "nested"},
		}},
		{name: "cyrillic segment", path: "заметки/файл.md", expected: []Crumb{
			{Name: "Home", URL: "/"}, {Name: "заметки", URL: "/p/%D0%B7%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B8/"},
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
	assert.Contains(t, body, `data-theme="dark"`)
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
	wb := &Web{Config: Config{
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

	wb := &Web{Config: Config{ListenAddr: ln.Addr().String()}}

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
