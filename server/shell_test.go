package server

import (
	"net/http"
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAppShell checks the contract web/README.md names: one mount node, and the
// color scheme resolved server side so the app does not paint the wrong theme
// before react mounts. Auto is the one case the server cannot answer, because a
// request does not carry the system preference.
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
				return
			}
			assert.Contains(t, body, `data-mantine-color-scheme="`+tc.scheme+`"`)
		})
	}
}

// TestAppShellStatus checks the one thing the shell cannot leave to the client
// router. A link to a note that is not there has to answer 404, because the
// status is all a crawler or a link checker reads, and neither runs javascript.
// Everything else is the router's own business and goes out as 200.
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

// TestAppShellNonceMatchesThePolicy is the join the whole scheme hangs on: the
// meta the client feeds to Mantine has to carry the very nonce this response
// authorized, or every style Mantine injects is blocked.
func TestAppShellNonceMatchesThePolicy(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, body := ts.do(t, request{path: "/"})

	// assert
	meta := regexp.MustCompile(`<meta name="csp-nonce" content="([^"]+)">`).FindStringSubmatch(body)
	require.Len(t, meta, 2)
	assert.Contains(t, resp.header.Get("Content-Security-Policy"), "'nonce-"+meta[1]+"'")
}

// TestAppShellLoadsTheBuiltBundle keeps the shell pointed at what `make ui`
// produced. The names are content hashed, so the manifest is the only place
// they can come from, and nothing in the document may be an inline script.
func TestAppShellLoadsTheBuiltBundle(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	resp, body := ts.do(t, request{path: "/"})

	// assert
	require.Equal(t, http.StatusOK, resp.status)
	assert.Regexp(t, `<script type="module" crossorigin src="`+appBase+`assets/[^"]+\.js"></script>`, body)
	assert.Contains(t, body, "/css/chroma.css",
		"render generates the highlighting stylesheet, so the bundle cannot carry it")
	for _, tag := range regexp.MustCompile(`<script[^>]*>`).FindAllString(body, -1) {
		assert.Contains(t, tag, "src=", "inline script in the app shell")
	}
}
