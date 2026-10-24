package server

import (
	"html/template"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/theme"
)

func themedRequest(cookie string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", http.NoBody)
	if cookie != "" {
		r.AddCookie(&http.Cookie{Name: themeCookie, Value: cookie})
	}
	return r
}

func TestThemeOf(t *testing.T) {
	light, dark := theme.AutoTheme(theme.Light), theme.AutoTheme(theme.Dark)
	auto := pageTheme{
		BarColors: []barColor{
			{Color: light.BarColor(), Media: "(prefers-color-scheme: light)"},
			{Color: dark.BarColor(), Media: "(prefers-color-scheme: dark)"},
		},
		TouchIcons: []touchIcon{
			{Href: "/static/v1/icons/apple-touch-icon.png?v=" + iconStamp(), Media: "(prefers-color-scheme: light)"},
			{Href: "/static/v1/icons/apple-touch-icon-dark.png?v=" + iconStamp(), Media: "(prefers-color-scheme: dark)"},
		},
	}

	tests := []struct {
		name     string
		cookie   string
		expected pageTheme
	}{
		{name: "no cookie", expected: auto},
		{name: "auto", cookie: theme.Auto, expected: auto},
		{name: "garbage", cookie: "neon", expected: auto},
		{name: "light", cookie: light.ID, expected: pageTheme{
			ID: light.ID, Name: light.Name, Scheme: theme.Light,
			BarColors:  []barColor{{Color: light.BarColor()}},
			TouchIcons: []touchIcon{{Href: "/static/v1/icons/apple-touch-icon.png?v=" + iconStamp()}},
		}},
		{name: "dark", cookie: dark.ID, expected: pageTheme{
			ID: dark.ID, Name: dark.Name, Scheme: theme.Dark,
			BarColors:  []barColor{{Color: dark.BarColor()}},
			TouchIcons: []touchIcon{{Href: "/static/v1/icons/apple-touch-icon-dark.png?v=" + iconStamp()}},
		}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act & assert
			assert.Equal(t, tc.expected, themeOf(themedRequest(tc.cookie), "v1"))
		})
	}
}

// the browser bar is painted before any stylesheet, so its color has to be in
// the head the server writes, for the theme the cookie names
func TestBarColorFollowsTheTheme(t *testing.T) {
	ts := newTestServer(t, testOpts{withAuth: true})
	client := ts.login(t)
	light, dark := theme.AutoTheme(theme.Light), theme.AutoTheme(theme.Dark)

	tests := []struct {
		name  string
		path  string
		theme string
		metas []string
	}{
		{name: "shell on auto", path: "/", metas: []string{
			`<meta name="theme-color" content="` + light.BarColor() + `" media="(prefers-color-scheme: light)">`,
			`<meta name="theme-color" content="` + dark.BarColor() + `" media="(prefers-color-scheme: dark)">`,
		}},
		{name: "shell in dark", path: "/", theme: dark.ID, metas: []string{
			`<meta name="theme-color" content="` + dark.BarColor() + `">`,
		}},
		{name: "sign-in page on auto", path: "/login", metas: []string{
			`<meta name="theme-color" content="` + light.BarColor() + `" media="(prefers-color-scheme: light)">`,
			`<meta name="theme-color" content="` + dark.BarColor() + `" media="(prefers-color-scheme: dark)">`,
		}},
		{name: "sign-in page in light", path: "/login", theme: light.ID, metas: []string{
			`<meta name="theme-color" content="` + light.BarColor() + `">`,
		}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			req := request{path: tc.path}
			if tc.path == "/" {
				req.client = client
			}
			if tc.theme != "" {
				req.headers = map[string]string{"Cookie": themeCookie + "=" + tc.theme}
			}

			// act
			resp, body := ts.do(t, req)

			// assert
			require.Equal(t, http.StatusOK, resp.status)
			assert.Equal(t, tc.metas, regexp.MustCompile(`<meta name="theme-color"[^>]*>`).FindAllString(body, -1))
		})
	}
}

func TestTouchIconFollowsTheTheme(t *testing.T) {
	ts := newTestServer(t, testOpts{withAuth: true})
	client := ts.login(t)
	link := func(name, media string) string {
		res := `<link rel="apple-touch-icon" href="/static/` + ts.Version + "/icons/" + name + "?v=" + iconStamp() + `"`
		if media != "" {
			res += ` media="(prefers-color-scheme: ` + media + `)"`
		}
		return res + ">"
	}
	both := []string{link("apple-touch-icon.png", "light"), link("apple-touch-icon-dark.png", "dark")}

	tests := []struct {
		name  string
		path  string
		theme string
		links []string
	}{
		{name: "shell without a choice", path: "/", links: both},
		{name: "shell on auto", path: "/", theme: "auto", links: both},
		{name: "shell in light", path: "/", theme: "light", links: []string{link("apple-touch-icon.png", "")}},
		{name: "shell in dark", path: "/", theme: "dark", links: []string{link("apple-touch-icon-dark.png", "")}},
		{name: "sign-in page on auto", path: "/login", links: both},
		{name: "sign-in page in light", path: "/login", theme: "light", links: []string{link("apple-touch-icon.png", "")}},
		{name: "sign-in page in dark", path: "/login", theme: "dark", links: []string{link("apple-touch-icon-dark.png", "")}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			req := request{path: tc.path}
			if tc.path == "/" {
				req.client = client
			}
			if tc.theme != "" {
				req.headers = map[string]string{"Cookie": themeCookie + "=" + tc.theme}
			}

			// act
			resp, body := ts.do(t, req)

			// assert
			require.Equal(t, http.StatusOK, resp.status)
			assert.Equal(t, tc.links, regexp.MustCompile(`<link rel="apple-touch-icon"[^>]*>`).FindAllString(body, -1))
		})
	}
}

func TestTouchIconsArePublic(t *testing.T) {
	ts := newTestServer(t, testOpts{withAuth: true})

	for _, name := range []string{"apple-touch-icon.png", "apple-touch-icon-dark.png"} {
		t.Run(name, func(t *testing.T) {
			// act
			icon, _ := ts.do(t, request{path: "/static/" + ts.Version + "/icons/" + name + "?v=" + iconStamp()})

			// assert
			assert.Equal(t, http.StatusOK, icon.status, "the icon is public: a phone fetches it without the session")
			assert.Equal(t, "image/png", icon.header.Get("Content-Type"))
		})
	}
}

// the sign-in page loads no bundle, so the colors of every theme reach it as
// the stylesheet `make ui` writes beside one, under the bundle's address
func TestSignInPageLoadsTheThemes(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	href := ts.appShell.base() + appThemes

	// act
	_, page := ts.do(t, request{path: "/login"})
	resp, css := ts.do(t, request{path: href})

	// assert
	assert.Contains(t, page, `<link rel="stylesheet" href="`+href+`">`)
	assert.Contains(t, page, `<meta name="scrawl-themes" content="`+template.HTMLEscapeString(themeOptions)+`">`)
	require.Equal(t, http.StatusOK, resp.status, "the sign-in page is public, and so is what it loads")
	assert.Contains(t, resp.header.Get("Content-Type"), "text/css")
	for _, entry := range theme.All() {
		assert.Contains(t, css, `:root[`+theme.Attr+`="`+entry.ID+`"] {`)
	}
}
