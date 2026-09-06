package render

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMermaidFence(t *testing.T) {
	tests := []struct{ name, src, want string }{
		{"diagram source is handed over verbatim", "```mermaid\ngraph TD;\n  A-->B;\n```\n",
			"<pre class=\"mermaid\">graph TD;\n  A--&gt;B;\n</pre>\n"},
		{"the language is matched case-insensitively", "```Mermaid\nx\n```\n", `<pre class="mermaid">`},
		{"an info string after the language still counts", "```mermaid title=x\ny\n```\n", `<pre class="mermaid">`},
		{"any other fence is highlighted as before", "```go\nfunc main() {}\n```\n",
			`<div class="code-block" data-lang="go">`},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := r.RenderInline([]byte(tt.src), "docs/x.md")
			require.NoError(t, err)
			assert.Contains(t, string(out), tt.want)
		})
	}
}

func TestMermaidFenceIsNeverHighlighted(t *testing.T) {
	// act
	out, err := New(Options{}).RenderInline([]byte("```mermaid\ngraph TD; A-->B;\n```\n"), "docs/x.md")

	// assert
	require.NoError(t, err)
	assert.NotContains(t, string(out), "chroma")
	assert.NotContains(t, string(out), "code-block")
}

func TestEmojiShortcodes(t *testing.T) {
	tests := []struct{ name, src, want string }{
		{"known shortcode", ":tada:\n", "<p>🎉</p>"},
		{"shortcode with a plus", ":+1:\n", "<p>👍</p>"},
		{"unknown shortcode", ":nosuchemojiname:\n", "<p>:nosuchemojiname:</p>"},
		{"a colon in prose", "время 10:30 и a:b\n", "<p>время 10:30 и a:b</p>"},
		{"empty pair of colons", "::\n", "<p>::</p>"},
		{"code span", "`:tada:`\n", "<p><code>:tada:</code></p>"},
		{"fence", "```text\n:tada:\n```\n", ":tada:\n"},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := r.RenderInline([]byte(tt.src), "docs/x.md")
			require.NoError(t, err)
			assert.Contains(t, string(out), tt.want)
		})
	}
}
