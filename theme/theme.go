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

const Attr = "data-scrawl-theme"

const Auto = "auto"

type Scheme string

const (
	Light Scheme = "light"
	Dark  Scheme = "dark"
)

var BlockNames = []string{"gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"}

var ShadowNames = []string{"small", "medium", "large"}

var CodeNames = []string{"keyword", "string", "comment", "function", "number", "builtin"}

type BlockColor struct {
	Text string `json:"text"`
	Bg   string `json:"bg"`
}

type Theme struct {
	ID      string                `json:"-"`
	Name    string                `json:"name"`
	Scheme  Scheme                `json:"scheme"`
	Code    map[string]string     `json:"code"`
	Palette map[string]string     `json:"palette"`
	Blocks  map[string]BlockColor `json:"blocks"`
	Shadows map[string]string     `json:"shadows"`
}

func (t Theme) BarColor() string {
	return t.Palette["bg"]
}

//go:embed themes/*.json
var files embed.FS

var idPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

var codeColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

var all = mustLoad(files)

func All() []Theme {
	return slices.Clone(all)
}

func Lookup(id string) (Theme, bool) {
	idx := slices.IndexFunc(all, func(t Theme) bool { return t.ID == id })
	if idx < 0 {
		return Theme{}, false
	}
	return all[idx], true
}

func AutoTheme(scheme Scheme) Theme {
	res, _ := Lookup(string(scheme))
	return res
}

type Scope struct {
	Theme    Theme
	Media    string
	Selector string
}

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
	case res.BarColor() == "":
		return Theme{}, errors.New("no bg in the palette")
	}
	if err := checkColors(res); err != nil {
		return Theme{}, err
	}
	return res, nil
}

func checkColors(res Theme) error {
	for _, name := range BlockNames {
		if block := res.Blocks[name]; block.Text == "" || block.Bg == "" {
			return fmt.Errorf("no %s block color", name)
		}
	}
	for _, name := range ShadowNames {
		if res.Shadows[name] == "" {
			return fmt.Errorf("no %s shadow", name)
		}
	}
	for _, name := range CodeNames {
		if !codeColorPattern.MatchString(res.Code[name]) {
			return fmt.Errorf("the %s code color %q is not #rrggbb", name, res.Code[name])
		}
	}
	return nil
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
