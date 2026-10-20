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
		TouchIcon: "/static/v1/icons/apple-touch-icon.png?v=" + iconStamp(),
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
			BarColors: []barColor{{Color: light.BarColor()}},
			TouchIcon: "/static/v1/icons/apple-touch-icon.png?v=" + iconStamp(),
		}},
		{name: "dark", cookie: dark.ID, expected: pageTheme{
			ID: dark.ID, Name: dark.Name, Scheme: theme.Dark,
			BarColors: []barColor{{Color: dark.BarColor()}},
			TouchIcon: "/static/v1/icons/apple-touch-icon-dark.png?v=" + iconStamp(),
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

	tests := []struct {
		name  string
		path  string
		theme string
		icon  string
	}{
		{name: "shell without a choice", path: "/", icon: "apple-touch-icon.png"},
		{name: "shell on auto", path: "/", theme: "auto", icon: "apple-touch-icon.png"},
		{name: "shell in light", path: "/", theme: "light", icon: "apple-touch-icon.png"},
		{name: "shell in dark", path: "/", theme: "dark", icon: "apple-touch-icon-dark.png"},
		{name: "sign-in page in light", path: "/login", theme: "light", icon: "apple-touch-icon.png"},
		{name: "sign-in page in dark", path: "/login", theme: "dark", icon: "apple-touch-icon-dark.png"},
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
			iconURL := "/static/" + ts.Version + "/icons/" + tc.icon + "?v=" + iconStamp()

			// act
			resp, body := ts.do(t, req)
			icon, _ := ts.do(t, request{path: iconURL})

			// assert
			require.Equal(t, http.StatusOK, resp.status)
			assert.Contains(t, body, `<link rel="apple-touch-icon" href="`+iconURL+`">`)
			assert.Equal(t, http.StatusOK, icon.status, "the icon is public: a phone fetches it without the session")
			assert.Equal(t, "image/png", icon.header.Get("Content-Type"))
		})
	}
}

// the sign-in page loads no bundle, so the colors of every theme reach it as
// the stylesheet `make ui` writes beside one, under a name with no hash
func TestSignInPageLoadsTheThemes(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true})
	href := "/static/" + ts.Version + "/app/themes.css"

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
