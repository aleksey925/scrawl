package server

import (
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/store"
)

func writeNote(t *testing.T, root, name, body string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(name))
	require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o750))
	require.NoError(t, os.WriteFile(full, []byte(body), 0o600))
}

const spriteSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><view id="blue" viewBox="0 0 10 10"/><view id="red" viewBox="10 0 10 10"/></svg>`

func pngDataURL(t *testing.T) string {
	t.Helper()
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(tinyPNG(t))
}

func TestExportMarkdownIsTheStoredSource(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	want := "# Заметка\n\nтекст\n"
	writeNote(t, ts.root, "notes/заметка.md", want)

	// act
	resp, body := ts.do(t, request{path: "/api/export/notes/%D0%B7%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B0.md?format=md"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, want, body)
	assert.Equal(t, "text/markdown; charset=utf-8", resp.header.Get("Content-Type"))
	assert.Equal(t, "attachment; filename*=utf-8''%D0%B7%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B0.md", resp.header.Get("Content-Disposition"))
	assert.Equal(t, rawContentSecurityPolicy, resp.header.Get("Content-Security-Policy"))
	assert.Equal(t, "nosniff", resp.header.Get("X-Content-Type-Options"))
}

func TestExportHTMLIsAPageOfItsOwn(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	writeNote(t, ts.root, "docs/pictures.md", "# Pictures\n\n![logo](../images/logo.png)\n\n[guide](../guide.md)\n")

	// act
	resp, body := ts.do(t, request{path: "/api/export/docs/pictures.md?format=html"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, "text/html; charset=utf-8", resp.header.Get("Content-Type"))
	assert.Equal(t, `attachment; filename=pictures.html`, resp.header.Get("Content-Disposition"))
	assert.Equal(t, rawContentSecurityPolicy, resp.header.Get("Content-Security-Policy"))
	assert.Contains(t, body, "<!doctype html>")
	assert.Contains(t, body, "<title>Pictures</title>")
	assert.Contains(t, body, `src="`+pngDataURL(t)+`"`)
	assert.Contains(t, body, `href="../guide.md"`, "a link stays as written, the way scrawl render leaves it")
	assert.NotContains(t, body, "/s/"+testSpace+"/")
}

func TestExportRefusesWhatIsNotANote(t *testing.T) {
	tests := []struct {
		name   string
		path   string
		status int
	}{
		{name: "no format", path: "/api/export/guide.md", status: http.StatusBadRequest},
		{name: "pdf is printed by the browser", path: "/api/export/guide.md?format=pdf", status: http.StatusBadRequest},
		{name: "an attachment", path: "/api/export/snippet.py?format=md", status: http.StatusBadRequest},
		{name: "a markdown extension that is not a note", path: "/api/export/long.markdown?format=md", status: http.StatusBadRequest},
		{name: "a folder", path: "/api/export/docs?format=html", status: http.StatusBadRequest},
		{name: "a missing note", path: "/api/export/nope.md?format=md", status: http.StatusNotFound},
		{name: "outside the root", path: "/api/export/..%2F..%2Fetc%2Fpasswd.md?format=md", status: http.StatusBadRequest},
	}
	ts := newTestServer(t, testOpts{})

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, _ := ts.do(t, request{path: tc.path})

			// assert
			assert.Equal(t, tc.status, resp.status)
		})
	}
}

func TestExportNeedsACredential(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})

	// act
	anonymous, _ := ts.do(t, request{path: "/api/export/guide.md?format=md"})
	reader, _ := ts.do(t, request{path: "/api/export/guide.md?format=md", headers: bearer(testReadToken)})

	// assert
	assert.Equal(t, http.StatusUnauthorized, anonymous.status)
	assert.Equal(t, http.StatusOK, reader.status, "an export is a read, a read-only token takes it")
}

func TestPicturesEmbedOnlyWhatTheSpaceHolds(t *testing.T) {
	// arrange
	root := testNotes(t)
	writeNote(t, root, ".hidden/secret.png", string(tinyPNG(t)))
	writeNote(t, root, "images/big.png", string(make([]byte, 1024)))
	writeNote(t, root, "images/my logo.png", string(tinyPNG(t)))
	writeNote(t, root, "images/sprite.svg", spriteSVG)
	notes, err := store.New(store.Config{Root: root, Rescan: -1})
	require.NoError(t, err)
	t.Cleanup(func() { _ = notes.Close() })
	embedded := pngDataURL(t)
	sprite := "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(spriteSVG))

	tests := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "a relative picture",
			in:   `<p><img src="../images/logo.png" alt="logo"></p>`,
			want: `<p><img src="` + embedded + `" alt="logo"></p>`,
		},
		{
			name: "an escaped name and a query",
			in:   `<img src="../images/my%20logo.png?v=2">`,
			want: `<img src="` + embedded + `">`,
		},
		{
			name: "the views of one svg",
			in:   `<img src="../images/sprite.svg#blue"><img src="../images/sprite.svg#red">`,
			want: `<img src="` + sprite + `#blue"><img src="` + sprite + `#red">`,
		},
		{
			name: "every candidate of a source",
			in:   `<picture><source srcset="../images/logo.png 1x, ../images/logo.png 2x"><img src="x.gif"></picture>`,
			want: `<picture><source srcset="` + embedded + ` 1x, ` + embedded + ` 2x"><img src="x.gif"></picture>`,
		},
		{name: "a remote picture", in: `<img src="https://example.com/a.png">`, want: `<img src="https://example.com/a.png">`},
		{name: "an absolute path", in: `<img src="/images/logo.png">`, want: `<img src="/images/logo.png">`},
		{name: "out of the root", in: `<img src="../../logo.png">`, want: `<img src="../../logo.png">`},
		{name: "a hidden file", in: `<img src="../.hidden/secret.png">`, want: `<img src="../.hidden/secret.png">`},
		{name: "not a picture", in: `<img src="../snippet.py">`, want: `<img src="../snippet.py">`},
		{name: "a missing picture", in: `<img src="../images/none.png">`, want: `<img src="../images/none.png">`},
		{name: "over the budget", in: `<img src="../images/big.png">`, want: `<img src="../images/big.png">`},
		{name: "a link to a picture", in: `<a href="../images/logo.png">logo</a>`, want: `<a href="../images/logo.png">logo</a>`},
		{
			name: "everything else as it came",
			in:   "<pre><code>&lt;img src=&#34;../images/logo.png&#34;&gt;\n  indented</code></pre>",
			want: "<pre><code>&lt;img src=&#34;../images/logo.png&#34;&gt;\n  indented</code></pre>",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			pics := newPictures(notes, "docs", 512)

			// act
			got := pics.embed(tc.in)

			// assert
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestPicturesChargeEveryCopyToOneBudget(t *testing.T) {
	// arrange
	root := testNotes(t)
	writeNote(t, root, "images/other.png", string(tinyPNG(t)))
	notes, err := store.New(store.Config{Root: root, Rescan: -1})
	require.NoError(t, err)
	t.Cleanup(func() { _ = notes.Close() })
	embedded := pngDataURL(t)
	pics := newPictures(notes, "", int64(len(embedded)*3/2))

	// act
	got := pics.embed(`<img src="images/logo.png"><img src="images/logo.png"><img src="images/other.png">`)

	// assert
	assert.Equal(t, `<img src="`+embedded+`"><img src="images/logo.png"><img src="images/other.png">`, got)
}

func TestPicturesCountTheWholeDataURLBeforeReading(t *testing.T) {
	notes, err := store.New(store.Config{Root: testNotes(t), Rescan: -1})
	require.NoError(t, err)
	t.Cleanup(func() { _ = notes.Close() })
	embedded := pngDataURL(t)

	tests := []struct {
		name   string
		in     string
		budget int
	}{
		{name: "the prefix", in: `<img src="images/logo.png">`, budget: len(embedded) - 1},
		{name: "the fragment", in: `<img src="images/logo.png#view">`, budget: len(embedded)},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			pics := newPictures(notes, "", int64(tc.budget))

			// act
			got := pics.embed(tc.in)

			// assert
			assert.Equal(t, tc.in, got)
			assert.Empty(t, pics.done, "a picture that does not fit is not kept in memory")
			assert.Equal(t, int64(tc.budget), pics.budget)
		})
	}
}

func TestExportOfANoteTooLargeToRender(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})
	big := "# Big\n\n" + strings.Repeat("a", maxRenderBytes)
	writeNote(t, ts.root, "big.md", big)

	// act
	page, _ := ts.do(t, request{path: "/api/export/big.md?format=html"})
	source, body := ts.do(t, request{path: "/api/export/big.md?format=md"})

	// assert
	assert.Equal(t, http.StatusRequestEntityTooLarge, page.status)
	assert.Equal(t, http.StatusOK, source.status, "the source is sent as it is stored, whatever its size")
	assert.Equal(t, big, body)
}

func TestPicturesRefusedOverTheBudgetAreNeverCopied(t *testing.T) {
	// arrange
	root := testNotes(t)
	writeNote(t, root, "images/huge.png", strings.Repeat("x", 1<<20))
	notes, err := store.New(store.Config{Root: root, Rescan: -1})
	require.NoError(t, err)
	t.Cleanup(func() { _ = notes.Close() })
	pics := newPictures(notes, "", maxEmbeddedImages)
	pics.embed(`<img src="images/huge.png#a">`)
	pics.budget = 0
	refused := strings.Repeat(`<img src="images/huge.png#b">`, 50)
	var before, after runtime.MemStats

	// act
	runtime.ReadMemStats(&before)
	got := pics.embed(refused)
	runtime.ReadMemStats(&after)

	// assert
	assert.Equal(t, refused, got)
	assert.Less(t, after.TotalAlloc-before.TotalAlloc, uint64(4<<20), "a refused copy is checked before it is made")
}
