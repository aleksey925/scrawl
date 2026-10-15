// Package theme reads the color themes, one JSON file each in themes/. A theme
// is everything that changes when the reader picks another one: the colors, the
// highlighting of code and the weight of bold. The fonts, the spacing and the
// shape of a control are the same in every theme and stay in the frontend.
//
// The frontend build reads the same files, so a theme is added by dropping a
// file here and running `make ui`.
package theme

import (
	"cmp"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"path"
	"regexp"
	"slices"
	"strings"
)

// Attr is the attribute on the root element that names the theme the reader
// picked. Absent, the system preference picks between the two Auto themes.
const Attr = "data-scrawl-theme"

// Auto is the choice that follows the system preference.
const Auto = "auto"

// Scheme is the base a theme is built on, light or dark. It decides what the
// browser draws for a form control or a scrollbar, and which editor and
// diagram defaults apply.
type Scheme string

// The two schemes. A theme whose id is a scheme's name is the one Auto picks
// for it.
const (
	Light Scheme = "light"
	Dark  Scheme = "dark"
)

// Theme is one file of themes/, named by its file name.
type Theme struct {
	ID     string `json:"-"`
	Name   string `json:"name"`
	Scheme Scheme `json:"scheme"`
	// Code is the chroma style that highlights code
	Code    string            `json:"code"`
	Palette map[string]string `json:"palette"`
}

// BarColor is the color of the browser bar and of the home screen splash, the
// page's own ground.
func (t Theme) BarColor() string {
	return t.Palette["bgDefault"]
}

//go:embed themes/*.json
var files embed.FS

// an id lands in a cookie, an attribute and a selector unquoted by anything
var idPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

var all = mustLoad(files)

// All lists the themes in the order a picker shows them: the light ones first,
// the Auto one of each scheme ahead of the rest, the rest by name.
func All() []Theme {
	return slices.Clone(all)
}

// Lookup finds a theme by its id.
func Lookup(id string) (Theme, bool) {
	idx := slices.IndexFunc(all, func(t Theme) bool { return t.ID == id })
	if idx < 0 {
		return Theme{}, false
	}
	return all[idx], true
}

// AutoTheme is the theme Auto picks when the system prefers the scheme.
func AutoTheme(scheme Scheme) Theme {
	res, _ := Lookup(string(scheme))
	return res
}

// Scope is where the rules of one theme apply in a stylesheet.
type Scope struct {
	Theme Theme
	// Media is the condition the selector sits under, "" for none
	Media    string
	Selector string
}

// Scopes places every theme under its own value of Attr, and the two Auto
// themes once more under a root with no Attr, each behind its system
// preference. No two selectors match at once, so no rule needs to come last.
func Scopes() []Scope {
	res := make([]Scope, 0, len(all)+2)
	for _, scheme := range []Scheme{Light, Dark} {
		res = append(res, Scope{
			Theme:    AutoTheme(scheme),
			Media:    "(prefers-color-scheme: " + string(scheme) + ")",
			Selector: ":root:not([" + Attr + "])",
		})
	}
	for _, t := range all {
		res = append(res, Scope{Theme: t, Selector: ":root[" + Attr + `="` + t.ID + `"]`})
	}
	return res
}

func mustLoad(fsys fs.FS) []Theme {
	res, err := load(fsys)
	if err != nil {
		panic(fmt.Sprintf("theme: %v", err))
	}
	return res
}

func load(fsys fs.FS) ([]Theme, error) {
	names, err := fs.Glob(fsys, "themes/*.json")
	if err != nil {
		return nil, fmt.Errorf("list themes: %w", err)
	}
	res := make([]Theme, 0, len(names))
	for _, name := range names {
		t, err := loadOne(fsys, name)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		res = append(res, t)
	}
	for _, scheme := range []Scheme{Light, Dark} {
		idx := slices.IndexFunc(res, func(t Theme) bool { return t.ID == string(scheme) })
		if idx < 0 || res[idx].Scheme != scheme {
			return nil, fmt.Errorf("no %s theme of the %s scheme for Auto to follow", scheme, scheme)
		}
	}
	slices.SortFunc(res, compare)
	return res, nil
}

func loadOne(fsys fs.FS, name string) (Theme, error) {
	raw, err := fs.ReadFile(fsys, name)
	if err != nil {
		return Theme{}, fmt.Errorf("read: %w", err)
	}
	var res Theme
	if err = json.Unmarshal(raw, &res); err != nil {
		return Theme{}, fmt.Errorf("parse: %w", err)
	}
	res.ID = strings.TrimSuffix(path.Base(name), ".json")
	switch {
	case !idPattern.MatchString(res.ID):
		return Theme{}, fmt.Errorf("the file name is the id, and %q is not one", res.ID)
	case res.Name == "":
		return Theme{}, errors.New("no name")
	case res.Scheme != Light && res.Scheme != Dark:
		return Theme{}, fmt.Errorf("scheme %q is neither light nor dark", res.Scheme)
	case res.Code == "":
		return Theme{}, errors.New("no code style")
	case res.BarColor() == "":
		return Theme{}, errors.New("no bgDefault in the palette")
	}
	return res, nil
}

func compare(a, b Theme) int {
	rank := func(t Theme) int {
		res := 0
		if t.Scheme == Dark {
			res += 2
		}
		if t.ID != string(t.Scheme) {
			res++
		}
		return res
	}
	return cmp.Or(cmp.Compare(rank(a), rank(b)), cmp.Compare(a.Name, b.Name))
}
