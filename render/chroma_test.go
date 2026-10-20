package render

import (
	"bytes"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/theme"
)

func TestChromaCSS(t *testing.T) {
	css := string(ChromaCSS())

	t.Run("a theme's code colors are under its scope", func(t *testing.T) {
		for _, scope := range theme.Scopes() {
			assert.Contains(t, css, scope.Selector+" .chroma .k { color: "+scope.Theme.Code["keyword"]+" }", scope.Selector)
			assert.Contains(t, css, scope.Selector+" .chroma .c { color: "+scope.Theme.Code["comment"]+"; font-style: italic }", scope.Selector)
		}
	})

	t.Run("every scope is painted by the style of its theme", func(t *testing.T) {
		for _, scope := range theme.Scopes() {
			var want bytes.Buffer
			writeChromaRules(&want, codeStyle(scope.Theme), scope.Selector)
			assert.Contains(t, css, want.String(), scope.Selector)
			if scope.Media != "" {
				assert.Contains(t, css, "@media "+scope.Media+" {\n"+want.String())
			}
		}
	})

	// a rule outside every guard paints whichever theme it belongs to onto the
	// others, for every token they leave to the base color
	t.Run("every selector is scoped", func(t *testing.T) {
		for line := range strings.SplitSeq(css, "\n") {
			if !strings.Contains(line, "{") || strings.HasPrefix(line, "@media") || strings.HasPrefix(line, "/*") {
				continue
			}
			assert.True(t, strings.HasPrefix(line, ":root[") || strings.HasPrefix(line, ":root:not(["), line)
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
		{name: "an alias is normalized", src: "```docker-compose\nservices: {}\n```\n", wantLang: `data-lang="yaml"`, wantHighlight: true},
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
