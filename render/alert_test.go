package render

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAlertRules is GitHub's own behavior, checked case by case against
// api.github.com/markdown in "gfm" mode.
func TestAlertRules(t *testing.T) {
	tests := []struct {
		name, src string
		want      string // "" means the blockquote is left alone
	}{
		{name: "note", src: "> [!NOTE]\n> body\n", want: "alert alert-note"},
		{name: "tip", src: "> [!TIP]\n> body\n", want: "alert alert-tip"},
		{name: "important", src: "> [!IMPORTANT]\n> body\n", want: "alert alert-important"},
		{name: "warning", src: "> [!WARNING]\n> body\n", want: "alert alert-warning"},
		{name: "caution", src: "> [!CAUTION]\n> body\n", want: "alert alert-caution"},
		{name: "lowercase marker", src: "> [!note]\n> body\n", want: "alert alert-note"},
		{name: "mixed case marker", src: "> [!NoTe]\n> body\n", want: "alert alert-note"},
		{name: "no space after the quote marker", src: ">[!NOTE]\n> body\n", want: "alert alert-note"},
		{name: "three leading spaces", src: "   > [!NOTE]\n   > body\n", want: "alert alert-note"},
		{name: "trailing spaces on the marker line", src: "> [!NOTE]  \n> body\n", want: "alert alert-note"},
		{name: "blank quote line before the body", src: "> [!NOTE]\n>\n> body\n", want: "alert alert-note"},
		{name: "lazy continuation", src: "> [!NOTE]\n> one\ntwo\n", want: "alert alert-note"},
		{name: "text after the marker", src: "> [!NOTE] title\n> body\n"},
		{name: "marker on the second line", src: "> text\n> [!NOTE]\n> body\n"},
		{name: "unknown marker", src: "> [!FOO]\n> body\n"},
		{name: "marker without a body", src: "> [!NOTE]\n"},
		{name: "nested blockquote", src: "> > [!NOTE]\n> > body\n"},
		{name: "inside a list item", src: "- > [!NOTE]\n  > body\n"},
		{name: "four spaces is a code block", src: "    > [!NOTE]\n    > body\n"},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// act
			out, err := r.RenderInline([]byte(tt.src), "docs/x.md")

			// assert
			require.NoError(t, err)
			if tt.want == "" {
				assert.NotContains(t, string(out), `class="alert`, "output: %s", out)
				return
			}
			assert.Contains(t, string(out), `<div class="`+tt.want+`">`, "output: %s", out)
		})
	}
}

func TestAlertBodyKeepsEveryBlock(t *testing.T) {
	// act
	out, err := New(Options{}).RenderInline(
		[]byte("> [!NOTE]\n>\n> первый\n>\n> - a\n> - b\n>\n> > цитата\n"), "docs/x.md")

	// assert
	require.NoError(t, err)
	assert.Equal(t, `<div class="alert alert-note">`+"\n"+
		`<p class="alert-title">Note</p>`+"\n"+
		"<p>первый</p>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n"+
		"<blockquote>\n<p>цитата</p>\n</blockquote>\n</div>\n", string(out))
}

func TestAlertTitleIsNotTakenFromTheDocument(t *testing.T) {
	// act
	out, err := New(Options{}).RenderInline([]byte("> [!NOTE\"onclick=\"x]\n> body\n"), "docs/x.md")

	// assert
	require.NoError(t, err)
	assert.Equal(t, "<blockquote>\n<p>[!NOTE&#34;onclick=&#34;x]\nbody</p>\n</blockquote>\n", string(out))
}
