package render

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChromaCSS(t *testing.T) {
	css := string(ChromaCSS())

	t.Run("both themes are present", func(t *testing.T) {
		assert.Contains(t, css, "@media (prefers-color-scheme: light) {")
		assert.Contains(t, css, "@media (prefers-color-scheme: dark) {")
		assert.Contains(t, css, `:root:not([data-mantine-color-scheme="dark"]) .chroma`)
		assert.Contains(t, css, `:root:not([data-mantine-color-scheme="light"]) .chroma`)
		assert.Contains(t, css, `:root[data-mantine-color-scheme="light"] .chroma`)
		assert.Contains(t, css, `:root[data-mantine-color-scheme="dark"] .chroma`)
	})

	// a rule outside both guards paints whichever theme it belongs to onto the
	// other one, for every token the other leaves to the base color
	t.Run("no rule is left unguarded", func(t *testing.T) {
		for line := range strings.SplitSeq(css, "\n") {
			if !strings.HasPrefix(line, ":root .chroma") {
				continue
			}
			assert.Fail(t, "rule belongs to neither theme", line)
		}
	})

	t.Run("the chosen theme wins over the system one", func(t *testing.T) {
		system := strings.Index(css, `:root:not([data-mantine-color-scheme="light"]) .chroma `)
		chosen := strings.Index(css, `:root[data-mantine-color-scheme="dark"] .chroma `)
		assert.Positive(t, chosen)
		assert.Less(t, system, chosen)
	})

	t.Run("every selector is scoped", func(t *testing.T) {
		for line := range strings.SplitSeq(css, "\n") {
			if !strings.Contains(line, "{") || strings.HasPrefix(line, "@media") || strings.HasPrefix(line, "/*") {
				continue
			}
			assert.True(t, strings.HasPrefix(line, ":root"), line)
		}
	})

	t.Run("braces are balanced", func(t *testing.T) {
		assert.Equal(t, strings.Count(css, "{"), strings.Count(css, "}"))
	})
}

func TestHighlightUnknownLanguageFallsBack(t *testing.T) {
	tests := []struct {
		name, src, wantLang string
		wantHighlight       bool
	}{
		{name: "known language", src: "```python\nx = 1\n```\n", wantLang: `data-lang="python"`, wantHighlight: true},
		{name: "cyrillic es is normalized", src: "```с\nint x;\n```\n", wantLang: `data-lang="c"`, wantHighlight: true},
		{name: "unknown language", src: "```кириллица\ntext\n```\n", wantLang: `data-lang="кириллица"`},
		{name: "no language", src: "```\ntext\n```\n"},
		{name: "indented block", src: "    just text\n"},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := r.RenderInline([]byte(tt.src), "x.md")
			require.NoError(t, err)
			assert.Contains(t, string(out), `<div class="code-block"`)
			if tt.wantLang == "" {
				assert.NotContains(t, string(out), "data-lang=")
			} else {
				assert.Contains(t, string(out), tt.wantLang)
			}
			assert.Equal(t, tt.wantHighlight, strings.Contains(string(out), "<span class="))
		})
	}
}

func TestNormalizeFenceInfo(t *testing.T) {
	tests := []struct{ name, in, want string }{
		{"cyrillic es", "```с", "```c"},
		{"indented", "    ```cmd", "    ```batch"},
		{"extra info is kept", "```docker-compose title=x", "```yaml title=x"},
		{"unknown", "```rust", "```rust"},
		{"empty", "```", "```"},
		{"tilde fence", "~~~cmd", "~~~batch"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var fence fenceScanner
			require.True(t, fence.step(tt.in))
			assert.Equal(t, tt.want, normalizeFenceInfo(tt.in, fence.length))
		})
	}
}
