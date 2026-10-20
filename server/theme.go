package server

import (
	"encoding/json"
	"net/http"

	"github.com/aleksey925/scrawl/theme"
)

// themeCookie carries the reader's theme choice, so the server can render the
// right one and the page does not flash on load.
const themeCookie = "theme"

// barColor is one theme-color meta of a document head.
type barColor struct {
	Color string
	Media string
}

// touchIcon is one apple-touch-icon link of a document head.
type touchIcon struct {
	Href  string
	Media string
}

// pageTheme is what a document the server renders needs to open in the
// reader's theme. On auto the server knows no theme: the system preference is
// not something a request carries, and guessing it is the flash this exists to
// prevent.
type pageTheme struct {
	// ID and Name are the theme picked, "" on auto
	ID   string
	Name string
	// Scheme is the scheme of that theme, "" on auto
	Scheme    theme.Scheme
	BarColors []barColor
	// TouchIcons is the home screen icon of the theme picked, or on auto one
	// for each scheme behind the system preference
	TouchIcons []touchIcon
}

// themeOf resolves the theme cookie of a request, falling back to auto.
func themeOf(r *http.Request, version string) pageTheme {
	if c, err := r.Cookie(themeCookie); err == nil {
		if picked, ok := theme.Lookup(c.Value); ok {
			return pageTheme{
				ID:         picked.ID,
				Name:       picked.Name,
				Scheme:     picked.Scheme,
				BarColors:  []barColor{{Color: picked.BarColor()}},
				TouchIcons: []touchIcon{{Href: touchIconURL(version, picked.Scheme)}},
			}
		}
	}
	res := pageTheme{}
	for _, scheme := range []theme.Scheme{theme.Light, theme.Dark} {
		media := "(prefers-color-scheme: " + string(scheme) + ")"
		res.BarColors = append(res.BarColors, barColor{Color: theme.AutoTheme(scheme).BarColor(), Media: media})
		res.TouchIcons = append(res.TouchIcons, touchIcon{Href: touchIconURL(version, scheme), Media: media})
	}
	return res
}

// touchIconURL picks the home screen icon whose background is the page's own.
// iOS shrinks a closing app into its icon, and any other color shows as a rim.
func touchIconURL(version string, scheme theme.Scheme) string {
	name := "apple-touch-icon.png"
	if scheme == theme.Dark {
		name = "apple-touch-icon-dark.png"
	}
	return iconURL(version, "icons/"+name)
}

// themeOption is what the sign-in page's toggle knows of a theme.
type themeOption struct {
	ID       string       `json:"id"`
	Name     string       `json:"name"`
	Scheme   theme.Scheme `json:"scheme"`
	BarColor string       `json:"bar"`
}

// themeOptions lists every theme for the sign-in page's script, which cannot
// import the list the bundle carries.
var themeOptions = func() string {
	themes := theme.All()
	opts := make([]themeOption, 0, len(themes))
	for _, entry := range themes {
		opts = append(opts, themeOption{ID: entry.ID, Name: entry.Name, Scheme: entry.Scheme, BarColor: entry.BarColor()})
	}
	res, err := json.Marshal(opts)
	if err != nil {
		panic("server: theme options: " + err.Error())
	}
	return string(res)
}()
