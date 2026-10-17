package theme

import (
	"maps"
	"slices"
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

func TestLoad(t *testing.T) {
	const (
		light = `{"name": "Light", "scheme": "light", "code": "github", "palette": {"bgDefault": "#fff"}}`
		dark  = `{"name": "Dark", "scheme": "dark", "code": "github-dark", "palette": {"bgDefault": "#000"}}`
	)

	tests := []struct {
		name    string
		files   map[string]string
		wantIDs []string
		wantErr string
	}{
		{
			name: "sorted for the picker",
			files: map[string]string{
				"light.json": light,
				"dark.json":  dark,
				"dimmed.json": `{"name": "Dimmed", "scheme": "dark", "code": "github-dark",
					"palette": {"bgDefault": "#222"}}`,
				"sepia.json": `{"name": "Sepia", "scheme": "light", "code": "github",
					"palette": {"bgDefault": "#f4ecd8"}}`,
				"paper.json": `{"name": "Paper", "scheme": "light", "code": "github",
					"palette": {"bgDefault": "#fafafa"}}`,
			},
			wantIDs: []string{"light", "paper", "sepia", "dark", "dimmed"},
		},
		{
			name:    "no light theme",
			files:   map[string]string{"dark.json": dark},
			wantErr: "no light theme",
		},
		{
			name: "the light theme on the dark scheme",
			files: map[string]string{
				"light.json": `{"name": "Light", "scheme": "dark", "code": "github", "palette": {"bgDefault": "#fff"}}`,
				"dark.json":  dark,
			},
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
			name: "no name",
			files: map[string]string{"light.json": light, "dark.json": dark,
				"x.json": `{"scheme": "light", "code": "github", "palette": {"bgDefault": "#fff"}}`},
			wantErr: "no name",
		},
		{
			name: "unknown scheme",
			files: map[string]string{"light.json": light, "dark.json": dark,
				"x.json": `{"name": "X", "scheme": "dim", "code": "github", "palette": {"bgDefault": "#fff"}}`},
			wantErr: `scheme "dim"`,
		},
		{
			name: "no code style",
			files: map[string]string{"light.json": light, "dark.json": dark,
				"x.json": `{"name": "X", "scheme": "light", "palette": {"bgDefault": "#fff"}}`},
			wantErr: "no code style",
		},
		{
			name: "no ground",
			files: map[string]string{"light.json": light, "dark.json": dark,
				"x.json": `{"name": "X", "scheme": "light", "code": "github", "palette": {}}`},
			wantErr: "no bgDefault",
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
