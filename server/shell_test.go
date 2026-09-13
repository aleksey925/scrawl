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
		{name: "deep link", path: "/app/p/guide.md"},
		{name: "light", theme: "light", scheme: "light"},
		{name: "dark", theme: "dark", scheme: "dark"},
		{name: "auto is left to the client", theme: "auto"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			req := request{path: "/app"}
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
			assert.Contains(t, body, `<div id="scrawl-app-root" data-base="`+appMount+`"></div>`)
			if tc.scheme == "" {
				assert.NotContains(t, body, "data-mantine-color-scheme")
				return
			}
			assert.Contains(t, body, `data-mantine-color-scheme="`+tc.scheme+`"`)
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
	resp, body := ts.do(t, request{path: "/app"})

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
	resp, body := ts.do(t, request{path: "/app"})

	// assert
	require.Equal(t, http.StatusOK, resp.status)
	assert.Regexp(t, `<script type="module" crossorigin src="`+appBase+`assets/[^"]+\.js"></script>`, body)
	for _, tag := range regexp.MustCompile(`<script[^>]*>`).FindAllString(body, -1) {
		assert.Contains(t, tag, "src=", "inline script in the app shell")
	}
}
