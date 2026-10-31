package server

import (
	"encoding/json"
	"net/http"

	"github.com/aleksey925/scrawl/theme"
)

const themeCookie = "theme"

type barColor struct {
	Color string
	Media string
}

type touchIcon struct {
	Href  string
	Media string
}

type pageTheme struct {
	ID         string
	Name       string
	Scheme     theme.Scheme
	BarColors  []barColor
	TouchIcons []touchIcon
}

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

func touchIconURL(version string, scheme theme.Scheme) string {
	name := "apple-touch-icon.png"
	if scheme == theme.Dark {
		name = "apple-touch-icon-dark.png"
	}
	return iconURL(version, "icons/"+name)
}

type themeOption struct {
	ID       string       `json:"id"`
	Name     string       `json:"name"`
	Scheme   theme.Scheme `json:"scheme"`
	BarColor string       `json:"bar"`
}

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
