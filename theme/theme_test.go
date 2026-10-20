package theme

import (
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAll(t *testing.T) {
	// act
	got := All()

	// assert
	require.NotEmpty(t, got)
	assert.Equal(t, AutoTheme(Light), got[0])
	assert.True(t, slices.IsSortedFunc(got, compare))
}

// the frontend reads a palette as a fixed set of tokens, so a theme that left
// one out would paint that part of the page in the theme before it
func TestEveryThemeHasTheSamePalette(t *testing.T) {
	// arrange
	want := slices.Sorted(maps.Keys(AutoTheme(Light).Palette))

	for _, entry := range All() {
		t.Run(entry.ID, func(t *testing.T) {
			// act
			got := slices.Sorted(maps.Keys(entry.Palette))

			// assert
			assert.Equal(t, want, got)
		})
	}
}

func TestLookup(t *testing.T) {
	tests := []struct {
		name   string
		id     string
		wantOK bool
	}{
		{name: "a theme", id: "dark", wantOK: true},
		{name: "auto is a choice and not a theme", id: Auto},
		{name: "unknown", id: "neon"},
		{name: "empty", id: ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got, ok := Lookup(tc.id)

			// assert
			assert.Equal(t, tc.wantOK, ok)
			if tc.wantOK {
				assert.Equal(t, tc.id, got.ID)
			}
		})
	}
}

func TestAutoTheme(t *testing.T) {
	for _, scheme := range []Scheme{Light, Dark} {
		t.Run(string(scheme), func(t *testing.T) {
			// act
			got := AutoTheme(scheme)

			// assert
			assert.Equal(t, string(scheme), got.ID)
			assert.Equal(t, scheme, got.Scheme)
		})
	}
}

func TestScopes(t *testing.T) {
	// arrange
	want := []Scope{
		{Theme: AutoTheme(Light), Media: "(prefers-color-scheme: light)", Selector: `:root:not([data-scrawl-theme])`},
		{Theme: AutoTheme(Dark), Media: "(prefers-color-scheme: dark)", Selector: `:root:not([data-scrawl-theme])`},
	}
	for _, entry := range All() {
		want = append(want, Scope{Theme: entry, Selector: `:root[data-scrawl-theme="` + entry.ID + `"]`})
	}

	// act
	got := Scopes()

	// assert
	assert.Equal(t, want, got)
}

// themeJSON is a theme file that passes every check; drop names a block color,
// a shadow or a code color to leave out
func themeJSON(name, scheme, bg, drop string) string {
	blocks := make([]string, 0, len(BlockNames))
	for _, block := range BlockNames {
		if block != drop {
			blocks = append(blocks, fmt.Sprintf(`%q: {"text": "#111", "bg": "#eee"}`, block))
		}
	}
	shadows := make([]string, 0, len(ShadowNames))
	for _, shadow := range ShadowNames {
		if shadow != drop {
			shadows = append(shadows, fmt.Sprintf(`%q: "0 1px 2px #000"`, shadow))
		}
	}
	code := make([]string, 0, len(CodeNames))
	for _, token := range CodeNames {
		if token != drop {
			code = append(code, fmt.Sprintf(`%q: "#123456"`, token))
		}
	}
	palette := ""
	if bg != "" {
		palette = fmt.Sprintf(`"bg": %q`, bg)
	}
	return fmt.Sprintf(`{"name": %q, "scheme": %q, "code": {%s}, "palette": {%s}, "blocks": {%s}, "shadows": {%s}}`,
		name, scheme, strings.Join(code, ", "), palette, strings.Join(blocks, ", "), strings.Join(shadows, ", "))
}

func TestLoad(t *testing.T) {
	light := themeJSON("Light", "light", "#fff", "")
	dark := themeJSON("Dark", "dark", "#000", "")

	tests := []struct {
		name    string
		files   map[string]string
		wantIDs []string
		wantErr string
	}{
		{
			name: "sorted for the picker",
			files: map[string]string{
				"light.json":  light,
				"dark.json":   dark,
				"dimmed.json": themeJSON("Dimmed", "dark", "#222", ""),
				"sepia.json":  themeJSON("Sepia", "light", "#f4ecd8", ""),
				"paper.json":  themeJSON("Paper", "light", "#fafafa", ""),
			},
			wantIDs: []string{"light", "paper", "sepia", "dark", "dimmed"},
		},
		{
			name:    "no light theme",
			files:   map[string]string{"dark.json": dark},
			wantErr: "no light theme",
		},
		{
			name:    "the light theme on the dark scheme",
			files:   map[string]string{"light.json": themeJSON("Light", "dark", "#fff", ""), "dark.json": dark},
			wantErr: "no light theme",
		},
		{
			name:    "not json",
			files:   map[string]string{"light.json": light, "dark.json": dark, "bad.json": "{"},
			wantErr: "themes/bad.json: parse",
		},
		{
			name:    "an id a selector cannot hold",
			files:   map[string]string{"light.json": light, "dark.json": dark, "My Theme.json": light},
			wantErr: `"My Theme" is not one`,
		},
		{
			name:    "no name",
			files:   map[string]string{"light.json": light, "dark.json": dark, "x.json": themeJSON("", "light", "#fff", "")},
			wantErr: "no name",
		},
		{
			name:    "unknown scheme",
			files:   map[string]string{"light.json": light, "dark.json": dark, "x.json": themeJSON("X", "dim", "#fff", "")},
			wantErr: `scheme "dim"`,
		},
		{
			name: "no code colors",
			files: map[string]string{"light.json": light, "dark.json": dark,
				"x.json": `{"name": "X", "scheme": "light", "palette": {"bg": "#fff"}}`},
			wantErr: "no code colors",
		},
		{
			name:    "no code color",
			files:   map[string]string{"light.json": light, "dark.json": dark, "x.json": themeJSON("X", "light", "#fff", "comment")},
			wantErr: "no comment code color",
		},
		{
			name:    "no ground",
			files:   map[string]string{"light.json": light, "dark.json": dark, "x.json": themeJSON("X", "light", "", "")},
			wantErr: "no bg in the palette",
		},
		{
			name:    "no block color",
			files:   map[string]string{"light.json": light, "dark.json": dark, "x.json": themeJSON("X", "light", "#fff", "purple")},
			wantErr: "no purple block color",
		},
		{
			name:    "no shadow",
			files:   map[string]string{"light.json": light, "dark.json": dark, "x.json": themeJSON("X", "light", "#fff", "medium")},
			wantErr: "no medium shadow",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			fsys := fstest.MapFS{}
			for name, body := range tc.files {
				fsys["themes/"+name] = &fstest.MapFile{Data: []byte(body)}
			}

			// act
			got, err := load(fsys)

			// assert
			if tc.wantErr != "" {
				require.ErrorContains(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
			ids := make([]string, 0, len(got))
			for _, entry := range got {
				ids = append(ids, entry.ID)
			}
			assert.Equal(t, tc.wantIDs, ids)
		})
	}
}

func TestBarColorIsTheGround(t *testing.T) {
	// arrange
	light := AutoTheme(Light)

	// act
	got := light.BarColor()

	// assert
	assert.Equal(t, light.Palette["bg"], got)
}
