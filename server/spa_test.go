package server

import (
	"encoding/json"
	"maps"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/store"
	"github.com/aleksey925/scrawl/view"
)

// jsonValue round-trips a value through JSON, so an expectation can be built
// from the very helper the handler used instead of spelled out again.
func jsonValue(t *testing.T, v any) any {
	t.Helper()
	data, err := json.Marshal(v)
	require.NoError(t, err)
	var res any
	require.NoError(t, json.Unmarshal(data, &res))
	return res
}

func sortedKeys(m map[string]any) []string {
	return slices.Sorted(maps.Keys(m))
}

func nodeByName(t *testing.T, nodes []any, name string) map[string]any {
	t.Helper()
	for _, item := range nodes {
		node, ok := item.(map[string]any)
		require.True(t, ok)
		if node["name"] == name {
			return node
		}
	}
	require.Failf(t, "node not found", "no node named %q", name)
	return nil
}

func children(t *testing.T, node map[string]any) []any {
	t.Helper()
	res, ok := node["children"].([]any)
	require.True(t, ok)
	return res
}

func TestAPIPage(t *testing.T) {
	ts := newTestServer(t, testOpts{})

	tests := []struct {
		name     string
		path     string
		status   int
		fields   map[string]any
		contains string
	}{
		{name: "document", path: "/api/page/guide.md", status: http.StatusOK,
			fields: map[string]any{"kind": "document", "path": "guide.md",
				"title": "Guide", "show_toc": true, "edit_url": "/edit/guide.md", "missing": false},
			contains: "widgets and gadgets"},
		{name: "nested document", path: "/api/page/docs/sub/deep.md", status: http.StatusOK,
			fields:   map[string]any{"kind": "document", "path": "docs/sub/deep.md", "title": "Deep", "show_toc": false},
			contains: "nested body"},
		{name: "cyrillic document", path: "/api/page/notes/cyrillic.md", status: http.StatusOK,
			fields: map[string]any{"kind": "document", "title": "Заметки"}},
		{name: "missing document", path: "/api/page/nope.md", status: http.StatusNotFound,
			fields: map[string]any{"kind": "missing-document", "missing": true, "title": "nope.md",
				"edit_url": "/edit/nope.md", "html": ""}},
		{name: "missing attachment", path: "/api/page/nope.png", status: http.StatusNotFound,
			fields: map[string]any{"error": "not found"}},
		{name: "directory", path: "/api/page/docs", status: http.StatusConflict,
			fields: map[string]any{"kind": "directory", "url": "/doc/docs/"}},
		{name: "root", path: "/api/page/", status: http.StatusConflict,
			fields: map[string]any{"kind": "directory", "url": "/"}},
		{name: "a text file", path: "/api/page/snippet.py", status: http.StatusOK,
			fields: map[string]any{"kind": "file", "type": "text", "language": "Python", "lines": float64(1),
				"raw_url": "/raw/snippet.py", "edit_url": "/edit/snippet.py"}},
		{name: "a picture", path: "/api/page/images/logo.png", status: http.StatusOK,
			fields: map[string]any{"kind": "file", "type": "image", "raw_url": "/raw/images/logo.png"}},
		{name: "another markdown extension", path: "/api/page/long.markdown", status: http.StatusOK,
			fields: map[string]any{"kind": "file", "type": "text"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, body := ts.json(t, request{path: tc.path})

			// assert
			assert.Equal(t, tc.status, resp.status)
			for name, want := range tc.fields {
				assert.Equal(t, want, body[name], name)
			}
			if tc.contains != "" {
				assert.Contains(t, body["html"], tc.contains)
			}
		})
	}
}

func TestAPIPageOutlineMatchesTheRail(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	require.NoError(t, os.WriteFile(filepath.Join(ts.root, "flat.md"),
		[]byte("# One\n\n# Two\n\n# Three\n"), 0o600))
	source, _, err := ts.Spaces[0].Store.Read("guide.md")
	require.NoError(t, err)
	rendered, err := ts.Spaces[0].Renderer.Render(source, "guide.md")
	require.NoError(t, err)

	// act
	_, listed := ts.json(t, request{path: "/api/page/guide.md"})
	_, flat := ts.json(t, request{path: "/api/page/flat.md"})

	// assert
	assert.Equal(t, jsonValue(t, render.OutlineOf(rendered.TOC)), listed["toc"])
	assert.Equal(t, true, listed["show_toc"])
	assert.Equal(t, []any{}, flat["toc"], "three h1 headings are not the levels the rail lists")
	assert.Equal(t, false, flat["show_toc"])
}

func TestAPIPageGoesThroughThePageCache(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	ts.pages().put(testSpace, "guide.md", revOf(t, ts, "guide.md"),
		render.Result{HTML: "<p>served from the cache</p>", Title: "Cached"})

	// act
	resp, body := ts.json(t, request{path: "/api/page/guide.md"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, "<p>served from the cache</p>", body["html"])
	assert.Equal(t, "Cached", body["title"])
	assert.Equal(t, 1, ts.pages().len(), "the page route and this one share one entry")
}

func TestAPIPageRevalidatesWithTheRevision(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	first, body := ts.json(t, request{path: "/api/page/guide.md"})
	etag := first.header.Get("ETag")
	cached, cachedBody := ts.do(t, request{path: "/api/page/guide.md",
		headers: map[string]string{"If-None-Match": etag}})
	weak, _ := ts.do(t, request{path: "/api/page/guide.md",
		headers: map[string]string{"If-None-Match": "W/" + etag}})
	stale, staleBody := ts.do(t, request{path: "/api/page/guide.md",
		headers: map[string]string{"If-None-Match": `"gone"`}})

	// assert
	assert.Equal(t, strconv.Quote(revOf(t, ts, "guide.md")), etag)
	assert.Equal(t, body["rev"], revOf(t, ts, "guide.md"))
	assert.Equal(t, pageCacheControl, first.header.Get("Cache-Control"))
	assert.Equal(t, http.StatusNotModified, cached.status)
	assert.Empty(t, cachedBody)
	assert.Equal(t, etag, cached.header.Get("ETag"))
	assert.Equal(t, http.StatusNotModified, weak.status)
	assert.Equal(t, http.StatusOK, stale.status)
	assert.Contains(t, staleBody, "widgets and gadgets")
}

func TestAPIPageETagFollowsTheDocument(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	before, _ := ts.json(t, request{path: "/api/page/guide.md"})

	// act
	require.NoError(t, os.WriteFile(filepath.Join(ts.root, "guide.md"), []byte("# Guide\n\nrewritten\n"), 0o600))
	after, body := ts.json(t, request{path: "/api/page/guide.md",
		headers: map[string]string{"If-None-Match": before.header.Get("ETag")}})

	// assert
	assert.Equal(t, http.StatusOK, after.status)
	assert.NotEqual(t, before.header.Get("ETag"), after.header.Get("ETag"))
	assert.Contains(t, body["html"], "rewritten")
}

func TestAPIPageOffersCreatingAMissingDocument(t *testing.T) {
	tests := []struct {
		name      string
		opts      testOpts
		headers   map[string]string
		canCreate bool
	}{
		{name: "writable server", opts: testOpts{}, canCreate: true},
		{name: "read-only server", opts: testOpts{readOnly: true}, canCreate: false},
		{name: "read-write token", opts: testOpts{withAuth: true}, headers: bearer(testToken), canCreate: true},
		{name: "read-only token", opts: testOpts{withAuth: true}, headers: bearer(testReadToken), canCreate: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			ts := newTestServer(t, tc.opts)

			// act
			resp, body := ts.json(t, request{path: "/api/page/nope.md", headers: tc.headers})

			// assert
			assert.Equal(t, http.StatusNotFound, resp.status)
			assert.Equal(t, "missing-document", body["kind"])
			assert.Equal(t, true, body["missing"])
			assert.Equal(t, tc.canCreate, body["can_create"])
		})
	}
}

func TestAPIPageOfAFile(t *testing.T) {
	big := strings.Repeat("a log line of some length\n", (1<<20)/26)
	tests := []struct {
		name, file string
		data       []byte
		wantType   string
		wantPlain  bool
	}{
		{name: "a script is highlighted and stays text", file: "x.py", data: []byte("<script>alert(1)</script>\nx = 1\n"),
			wantType: view.FileText},
		{name: "text that is not utf-8", file: "x.txt", data: []byte{0xff, 0xfe, 'a', '\n'}, wantType: view.FileOther},
		{name: "text with a nul", file: "x.txt", data: []byte("a\x00b\n"), wantType: view.FileOther},
		{name: "a log too large to show", file: "x.log", data: []byte(strings.Repeat(big, 3)), wantType: view.FileOther},
		{name: "a log too large to color", file: "x.log", data: []byte(big), wantType: view.FileText, wantPlain: true},
		{name: "an unknown binary", file: "x.bin", data: []byte{1, 2, 3}, wantType: view.FileOther},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			ts := newTestServer(t, testOpts{})
			require.NoError(t, os.WriteFile(filepath.Join(ts.root, tc.file), tc.data, 0o600))

			// act
			resp, body := ts.json(t, request{path: "/api/page/" + tc.file})

			// assert
			assert.Equal(t, http.StatusOK, resp.status)
			assert.Equal(t, tc.wantType, body["type"])
			if tc.wantType != view.FileText {
				assert.Nil(t, body["html"])
				return
			}
			html, _ := body["html"].(string)
			assert.NotContains(t, html, "<script")
			assert.Equal(t, float64(strings.Count(string(tc.data), "\n")), body["lines"])
			assert.Equal(t, strings.Count(string(tc.data), "\n"), strings.Count(html, `<span class="line">`))
			assert.Equal(t, tc.wantPlain, !strings.Contains(html, `<span class="cl"><span class=`))
		})
	}
}

func TestAPIDir(t *testing.T) {
	ts := newTestServer(t, testOpts{})

	tests := []struct {
		name     string
		path     string
		status   int
		fields   map[string]any
		contains string
	}{
		{name: "listing", path: "/api/dir/images", status: http.StatusOK,
			fields: map[string]any{"kind": "directory", "path": "images", "title": "images"}},
		{name: "a readme is a row", path: "/api/dir/docs", status: http.StatusOK,
			fields: map[string]any{"kind": "directory", "path": "docs", "title": "docs"}},
		{name: "the root is its list", path: "/api/dir/", status: http.StatusOK,
			fields: map[string]any{"kind": "directory", "path": "", "title": "Home"}},
		{name: "a folder with an index is its list", path: "/api/dir/notes", status: http.StatusOK,
			fields: map[string]any{"kind": "directory", "path": "notes", "title": "notes"}},
		{name: "document", path: "/api/dir/guide.md", status: http.StatusConflict,
			fields: map[string]any{"kind": "document", "url": "/doc/guide.md"}},
		{name: "a file", path: "/api/dir/snippet.py", status: http.StatusConflict,
			fields: map[string]any{"kind": "document", "url": "/doc/snippet.py"}},
		{name: "missing", path: "/api/dir/nope", status: http.StatusNotFound,
			fields: map[string]any{"error": "not found"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, body := ts.json(t, request{path: tc.path})

			// assert
			assert.Equal(t, tc.status, resp.status)
			for name, want := range tc.fields {
				assert.Equal(t, want, body[name], name)
			}
			if tc.contains != "" {
				assert.Contains(t, body["html"], tc.contains)
			}
		})
	}
}

func TestAPIDirTagsTheFolderPage(t *testing.T) {
	tests := []struct {
		name  string
		files []string
		want  []any
	}{
		{name: "an index in another case", files: []string{"INDEX.md", "page.md"}, want: []any{true, nil}},
		{name: "two cases of the name", files: []string{"INDEX.md", "index.md"}, want: []any{nil, nil}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			ts := newTestServer(t, testOpts{})
			for _, name := range tc.files {
				writeNote(t, ts.root, "tagged/"+name, "# "+name+"\n")
			}
			if entries, err := os.ReadDir(filepath.Join(ts.root, "tagged")); err != nil || len(entries) != len(tc.files) {
				t.Skip("the filesystem folds the case of a name, so it holds one of them")
			}

			// act
			resp, body := ts.json(t, request{path: "/api/dir/tagged"})

			// assert
			assert.Equal(t, http.StatusOK, resp.status)
			entries, ok := body["entries"].([]any)
			require.True(t, ok)
			got := []any{}
			for _, entry := range entries {
				got = append(got, entry.(map[string]any)["folder_page"])
			}
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestAPIDirListsWhatTheDirectoryPageLists(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	entries, err := ts.Spaces[0].Store.List("docs")
	require.NoError(t, err)

	// act
	resp, body := ts.json(t, request{path: "/api/dir/docs"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, jsonValue(t, view.DirEntries(entries, view.ItemsIn(ts.Spaces[0].Store.List), editable)), body["entries"])
	assert.NotContains(t, body, "readme_html")
}

func TestAPINav(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, body := ts.json(t, request{path: "/api/nav?path=docs/sub/deep.md"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	tree, ok := body["tree"].([]any)
	require.True(t, ok)

	names := []string{}
	for _, item := range tree {
		names = append(names, item.(map[string]any)["name"].(string))
	}
	assert.Equal(t, []string{"docs", "images", "notes", "guide.md", "index.md", "links.md"}, names,
		"directories first, then the documents, each under its full name")

	docs := nodeByName(t, tree, "docs")
	assert.Equal(t, map[string]any{"name": "docs", "path": "docs", "url": "/doc/docs/", "is_dir": true,
		"active": true, "current": false, "children": children(t, docs)}, docs)

	sub := nodeByName(t, children(t, docs), "sub")
	assert.Equal(t, true, sub["active"])
	assert.Equal(t, false, sub["current"])

	deep := nodeByName(t, children(t, sub), "deep.md")
	assert.Equal(t, map[string]any{"name": "deep.md", "path": "docs/sub/deep.md", "url": "/doc/docs/sub/deep.md",
		"is_dir": false, "active": false, "current": true, "children": []any{}}, deep)
}

func TestAPINavMarksNothingWithoutACurrentPath(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, body := ts.json(t, request{path: "/api/nav"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, jsonValue(t, ts.mount().treeNodes("")), body["tree"])
	assert.Equal(t, jsonValue(t, view.Breadcrumbs("")), body["breadcrumbs"])
	docs := nodeByName(t, body["tree"].([]any), "docs")
	assert.Equal(t, false, docs["active"])
}

func TestAPINavIsNotTheTokenTree(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	_, nav := ts.json(t, request{path: "/api/nav?path=guide.md"})
	_, tokenTree := ts.json(t, request{path: "/api/tree"})

	// assert
	navFirst, ok := nav["tree"].([]any)[0].(map[string]any)
	require.True(t, ok)
	tokenFirst, ok := tokenTree["tree"].([]any)[0].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, []string{"active", "children", "current", "is_dir", "name", "path", "url"}, sortedKeys(navFirst))
	assert.Equal(t, []string{"children", "is_dir", "name", "path"}, sortedKeys(tokenFirst))
}

func TestSPABreadcrumbsMatchThePageTrail(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	want := jsonValue(t, view.Breadcrumbs("docs/sub/deep.md"))

	// act
	_, page := ts.json(t, request{path: "/api/page/docs/sub/deep.md"})
	_, nav := ts.json(t, request{path: "/api/nav?path=docs/sub/deep.md"})
	_, dir := ts.json(t, request{path: "/api/dir/docs/sub"})

	// assert
	assert.Equal(t, []any{
		map[string]any{"name": "Home", "url": "/"},
		map[string]any{"name": "docs", "url": "/doc/docs/"},
		map[string]any{"name": "sub", "url": "/doc/docs/sub/"},
		map[string]any{"name": "deep.md", "url": ""},
	}, want)
	assert.Equal(t, want, page["breadcrumbs"])
	assert.Equal(t, want, nav["breadcrumbs"])
	assert.Equal(t, jsonValue(t, view.Breadcrumbs("docs/sub")), dir["breadcrumbs"])
}

func TestSPARefusesABadPath(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, body := ts.json(t, request{path: "/api/nav?path=%00"})

	// assert
	assert.Equal(t, http.StatusBadRequest, resp.status)
	assert.Equal(t, "bad path", body["error"])
}

func TestAPIMeWithAuthDisabled(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, body := ts.json(t, request{path: "/api/me"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, map[string]any{
		"user": "", "auth_on": false, "read_only": false,
		"history_on": false, "history_degraded": false,
		"site_title": ts.Title, "version": ts.Version,
		"space": map[string]any{
			"name": testSpace, "label": testSpace, "kind": KindLocal,
			"read_only": false, "format_on_save": false,
			"degraded": false, "unpublished": false, "sync_error": "",
			"unsynced": map[string]any{"paths": []any{}, "many": false},
			"diverged": false, "can_reset": false, "push_refused": false,
		},
	}, body)
}

func TestAPIMeNamesTheSession(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	client := ts.login(t)

	// act
	anonymous, _ := ts.json(t, request{path: "/api/me"})
	signed, signedBody := ts.json(t, request{path: "/api/me", client: client})
	token, tokenBody := ts.json(t, request{path: "/api/me", headers: bearer(testReadToken)})

	// assert
	assert.Equal(t, http.StatusUnauthorized, anonymous.status)
	assert.Equal(t, http.StatusOK, signed.status)
	assert.Equal(t, testUser, signedBody["user"])
	assert.Equal(t, true, signedBody["auth_on"])
	assert.Equal(t, http.StatusOK, token.status)
	assert.Equal(t, "reader", tokenBody["user"], "an API client is named after its token")
}

func TestReadOnlyStillServesTheSPAReads(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{readOnly: true})

	// act
	page, pageBody := ts.json(t, request{path: "/api/page/guide.md"})
	dir, _ := ts.json(t, request{path: "/api/dir/images"})
	nav, _ := ts.json(t, request{path: "/api/nav"})
	me, meBody := ts.json(t, request{path: "/api/me"})

	// assert
	assert.Equal(t, http.StatusOK, page.status)
	assert.Equal(t, false, pageBody["can_create"])
	assert.Equal(t, http.StatusOK, dir.status)
	assert.Equal(t, http.StatusOK, nav.status)
	assert.Equal(t, http.StatusOK, me.status)
	assert.Equal(t, true, meBody["read_only"])
}

func TestSPAReadsNeedACredential(t *testing.T) {
	ts := newTestServer(t, testOpts{withAuth: true})
	client := ts.login(t)

	tests := []struct {
		name string
		path string
	}{
		{name: "page", path: "/api/page/guide.md"},
		{name: "dir", path: "/api/dir/docs"},
		{name: "nav", path: "/api/nav?path=guide.md"},
		{name: "me", path: "/api/me"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			anonymous, body := ts.json(t, request{path: tc.path})
			signed, _ := ts.json(t, request{path: tc.path, client: client})
			token, _ := ts.json(t, request{path: tc.path, headers: bearer(testReadToken)})

			// assert
			assert.Equal(t, http.StatusUnauthorized, anonymous.status)
			assert.Equal(t, "unauthorized", body["error"])
			assert.Equal(t, http.StatusOK, signed.status)
			assert.Equal(t, http.StatusOK, token.status, "a read-only token reads everything")
		})
	}
}

func TestAPILogin(t *testing.T) {
	tests := []struct {
		name     string
		withAuth bool
		body     map[string]string
		status   int
		fields   map[string]any
		cookie   bool
	}{
		{name: "right credentials", withAuth: true, status: http.StatusOK, cookie: true,
			body:   map[string]string{"username": testUser, "password": testPassword},
			fields: map[string]any{"user": testUser}},
		{name: "wrong password", withAuth: true, status: http.StatusUnauthorized,
			body:   map[string]string{"username": testUser, "password": "nope"},
			fields: map[string]any{"error": "wrong user name or password"}},
		{name: "unknown user", withAuth: true, status: http.StatusUnauthorized,
			body:   map[string]string{"username": "eve", "password": testPassword},
			fields: map[string]any{"error": "wrong user name or password"}},
		{name: "empty credentials", withAuth: true, status: http.StatusUnauthorized,
			body:   map[string]string{},
			fields: map[string]any{"error": "wrong user name or password"}},
		{name: "auth disabled", withAuth: false, status: http.StatusOK,
			body:   map[string]string{"username": testUser, "password": testPassword},
			fields: map[string]any{"user": ""}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			ts := newTestServer(t, testOpts{withAuth: tc.withAuth})

			// act
			resp, body := ts.json(t, request{method: http.MethodPost, path: "/api/login", body: jsonBody(t, tc.body)})

			// assert
			assert.Equal(t, tc.status, resp.status)
			for name, want := range tc.fields {
				assert.Equal(t, want, body[name], name)
			}
			assert.Equal(t, tc.cookie, resp.header.Get("Set-Cookie") != "")
		})
	}
}

func TestAPILoginStartsTheSessionTheAppAccepts(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	client := noRedirectClient(t)

	// act
	in, _ := ts.json(t, request{method: http.MethodPost, path: "/api/login", client: client,
		body: jsonBody(t, map[string]string{"username": testUser, "password": testPassword})})
	me, meBody := ts.json(t, request{path: "/api/me", client: client})
	page, _ := ts.do(t, request{path: "/doc/guide.md", client: client})
	out, _ := ts.json(t, request{method: http.MethodPost, path: "/api/logout", client: client})
	after, _ := ts.json(t, request{path: "/api/me", client: client})

	// assert
	assert.Equal(t, http.StatusOK, in.status)
	assert.Equal(t, http.StatusOK, me.status)
	assert.Equal(t, testUser, meBody["user"])
	assert.Equal(t, http.StatusOK, page.status, "the cookie the form issues and this one are the same")
	assert.Equal(t, http.StatusNoContent, out.status)
	assert.Equal(t, http.StatusUnauthorized, after.status)
}

func TestAPILoginMalformedBody(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})

	// act
	resp, body := ts.json(t, request{method: http.MethodPost, path: "/api/login", body: strings.NewReader("{oops")})

	// assert
	assert.Equal(t, http.StatusBadRequest, resp.status)
	assert.Equal(t, "malformed json body", body["error"])
	assert.Empty(t, resp.header.Get("Set-Cookie"))
}

func TestAPILoginThrottlesOnTheFormBudget(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	form := url.Values{"username": {testUser}, "password": {"wrong"}}
	apiAttempt := func() (response, map[string]any) {
		return ts.json(t, request{method: http.MethodPost, path: "/api/login",
			body: jsonBody(t, map[string]string{"username": testUser, "password": "wrong"})})
	}

	// act
	first, firstBody := apiAttempt()
	for range 10 {
		ts.do(t, request{method: http.MethodPost, path: "/login", body: strings.NewReader(form.Encode()),
			headers: map[string]string{"Content-Type": "application/x-www-form-urlencoded"}})
	}
	last, lastBody := apiAttempt()

	// assert
	assert.Equal(t, http.StatusUnauthorized, first.status)
	assert.Equal(t, "wrong user name or password", firstBody["error"])
	assert.Equal(t, http.StatusTooManyRequests, last.status, "the form and this route charge one budget")
	assert.Equal(t, loginRetryAfter, last.header.Get("Retry-After"))
	assert.Equal(t, "too many attempts, wait a minute and try again", lastBody["error"])
}

func TestAPILoginIsNotACrossSiteTarget(t *testing.T) {
	ts := newTestServer(t, testOpts{withAuth: true})
	client := ts.login(t)

	tests := []struct {
		name string
		path string
	}{
		{name: "login", path: "/api/login"},
		{name: "logout", path: "/api/logout"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, _ := ts.json(t, request{method: http.MethodPost, path: tc.path, client: client,
				body:    jsonBody(t, map[string]string{"username": testUser, "password": testPassword}),
				headers: crossSite(nil)})

			// assert
			assert.Equal(t, http.StatusForbidden, resp.status)
			assert.Empty(t, resp.header.Get("Set-Cookie"))
		})
	}
}

func TestManifestIsPublic(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})

	// act
	resp, body := ts.do(t, request{path: "/manifest.webmanifest"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Contains(t, resp.header.Get("Content-Type"), "application/manifest+json")
	assert.Contains(t, body, `"start_url":"/"`)
	assert.Contains(t, body, ts.Title)
}

func TestAPIMeReportsFormatOnSave(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{formatOnSave: true})

	// act
	resp, body := ts.json(t, request{path: "/api/me"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, true, body["space"].(map[string]any)["format_on_save"])
}

func TestEditable(t *testing.T) {
	tests := []struct {
		name string
		fi   store.FileInfo
		want bool
	}{
		{name: "a note", fi: store.FileInfo{Path: "docs/a.md", Size: 10}, want: true},
		{name: "a text file", fi: store.FileInfo{Path: "docs/log.txt", Size: 10}, want: true},
		{name: "a picture", fi: store.FileInfo{Path: "docs/pic.png", Size: 10}, want: false},
		{name: "a text file too large to load", fi: store.FileInfo{Path: "docs/big.txt", Size: maxEditableFile + 1}, want: false},
		{name: "a known name with no extension", fi: store.FileInfo{Path: "tools/Makefile", Size: 10}, want: true},
		{name: "a folder named like a note", fi: store.FileInfo{Path: "docs/sub.md", IsDir: true}, want: false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act & assert
			assert.Equal(t, tc.want, editable(tc.fi))
		})
	}
}
