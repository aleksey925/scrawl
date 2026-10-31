package server

import (
	"net/http"
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAppShell(t *testing.T) {
	ts := newTestServer(t, testOpts{})

	tests := []struct {
		name   string
		path   string
		theme  string
		scheme string
	}{
		{name: "root"},
		{name: "deep link", path: "/doc/guide.md"},
		{name: "light", theme: "light", scheme: "light"},
		{name: "dark", theme: "dark", scheme: "dark"},
		{name: "auto is left to the client", theme: "auto"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			req := request{path: "/"}
			if tc.path != "" {
				req.path = tc.path
			}
			if tc.theme != "" {
				req.headers = map[string]string{"Cookie": themeCookie + "=" + tc.theme}
			}

			// act
			resp, body := ts.do(t, req)

			// assert
			require.Equal(t, http.StatusOK, resp.status)
			assert.Contains(t, resp.header.Get("Content-Type"), "text/html")
			assert.Contains(t, body, `<div id="scrawl-app-root" data-base="`+ts.prefix()+`"></div>`)
			if tc.scheme == "" {
				assert.NotContains(t, body, "data-mantine-color-scheme")
				assert.NotContains(t, body, "data-scrawl-theme")
				return
			}
			assert.Contains(t, body, `<html lang="en" data-scrawl-theme="`+tc.theme+`" data-mantine-color-scheme="`+tc.scheme+`">`)
		})
	}
}

func TestAppShellStatus(t *testing.T) {
	ts := newTestServer(t, testOpts{})

	tests := []struct {
		name   string
		path   string
		status int
	}{
		{name: "document that exists", path: "/doc/guide.md", status: http.StatusOK},
		{name: "document that does not", path: "/doc/nope.md", status: http.StatusNotFound},
		{name: "missing document in a folder", path: "/doc/docs/nope.md", status: http.StatusNotFound},
		{name: "editing a missing document is how it is created", path: "/edit/nope.md", status: http.StatusOK},
		{name: "a directory is not a missing document", path: "/doc/docs", status: http.StatusOK},
		{name: "the app root", path: "/", status: http.StatusOK},
		{name: "the search page", path: "/search", status: http.StatusOK},
		{name: "the notes opened last", path: "/recent", status: http.StatusOK},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, body := ts.do(t, request{path: tc.path})

			// assert
			assert.Equal(t, tc.status, resp.status)
			assert.Contains(t, body, `id="scrawl-app-root"`, "the shell is served whatever the status")
		})
	}
}

func TestAppShellLoadsTheBuiltBundle(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, body := ts.do(t, request{path: "/"})

	// assert
	require.Equal(t, http.StatusOK, resp.status)
	assert.Regexp(t, `<script type="module" crossorigin src="`+appBase(ts.appShell.version)+`assets/[^"]+\.js"></script>`, body)
	assert.Contains(t, body, "/css/chroma.css",
		"render generates the highlighting stylesheet, so the bundle cannot carry it")
	for _, tag := range regexp.MustCompile(`<script[^>]*>`).FindAllString(body, -1) {
		assert.Contains(t, tag, "src=", "inline script in the app shell")
	}
}

func TestShellCSSLinksTheImportedChunksAfterTheEntry(t *testing.T) {
	// arrange
	chunks := map[string]manifestChunk{
		"index.html":  {File: "assets/index.js", IsEntry: true, CSS: []string{"assets/index.css"}, Imports: []string{"_chrome.js", "_nav.js"}},
		"_chrome.js":  {File: "assets/chrome.js", CSS: []string{"assets/chrome.css"}, Imports: []string{"_runtime.js"}},
		"_nav.js":     {File: "assets/nav.js", Imports: []string{"_chrome.js", "_deep.js"}},
		"_deep.js":    {File: "assets/deep.js", CSS: []string{"assets/deep.css", "assets/chrome.css"}},
		"_runtime.js": {File: "assets/runtime.js"},
	}

	// act
	got := shellCSS(chunks, chunks["index.html"])

	// assert
	assert.Equal(t, []string{"assets/index.css", "assets/chrome.css", "assets/deep.css"}, got)
}
