package render

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMathInlineDelimiters is GitHub's own behavior, each row checked against
// api.github.com/markdown in "gfm" mode.
func TestMathInlineDelimiters(t *testing.T) {
	tests := []struct {
		name, src string
		want      string // "" means no math
	}{
		{name: "plain", src: "$x+1$", want: "x+1"},
		{name: "digits only", src: "$100$", want: "100"},
		{name: "leading minus", src: "$-x$", want: "-x"},
		{name: "trailing minus", src: "$x-$", want: "x-"},
		{name: "space before the closer is allowed", src: "$x+1 $", want: "x+1 "},
		{name: "words inside", src: "$5 apples$", want: "5 apples"},
		{name: "underscores do not emphasize", src: "$x_1 + y_2$", want: "x_1 + y_2"},
		{name: "punctuation after the closer", src: "$x$. end", want: "x"},
		{name: "parenthesised", src: "($x$)", want: "x"},
		{name: "backtick form", src: "$`\\frac{a}{b}`$", want: "\\frac{a}{b}"},
		{name: "backtick form keeps an escaped dollar", src: "$`\\sqrt{\\$4}`$", want: "\\sqrt{\\$4}"},
		{name: "two amounts", src: "costs $100 and $200 total"},
		{name: "amounts with punctuation", src: "cost $5, or $6."},
		{name: "trailing currency", src: "costs 1$, a mango 2$."},
		{name: "space after the opener", src: "$ x+1$"},
		{name: "spaces on both sides", src: "$ x + 1 $"},
		{name: "letter after the closer", src: "a $b$c"},
		{name: "digit after the closer", src: "$x$2"},
		{name: "letter before the opener", src: "a$b$ end"},
		{name: "amounts with no space", src: "a $100$200 b"},
		{name: "escaped dollars", src: "\\$5 and \\$6"},
		{name: "code span", src: "`$x+1$`"},
		{name: "shell variables", src: "$HOME и $PATH"},
		{name: "regex group references", src: "через $0 - $9 в тексте"},
		{name: "empty", src: "$$ and $ $"},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// act
			out, err := r.RenderInline([]byte(tt.src+"\n"), "docs/x.md")

			// assert
			require.NoError(t, err)
			if tt.want == "" {
				assert.NotContains(t, string(out), `class="math`, "output: %s", out)
				return
			}
			assert.Contains(t, string(out), `<span class="math math-inline">`+tt.want+"</span>", "output: %s", out)
		})
	}
}

func TestMathTwoExpressionsOnOneLine(t *testing.T) {
	// act
	out, err := New(Options{}).RenderInline([]byte("$a$ and $b$\n"), "docs/x.md")

	// assert
	require.NoError(t, err)
	assert.Equal(t, 2, strings.Count(string(out), `class="math math-inline"`))
}

func TestMathDisplay(t *testing.T) {
	tests := []struct{ name, src, want string }{
		{"block on its own lines", "$$\nx = y\n$$\n", `<div class="math math-display">x = y` + "\n</div>"},
		{"block on one line", "$$x = y$$\n", `<div class="math math-display">x = y</div>`},
		{"fence", "```math\nx = y\n```\n", `<div class="math math-display">x = y` + "\n</div>"},
		{"multi line block", "$$\na\nb\n$$\n", `<div class="math math-display">a` + "\nb\n</div>"},
		{"inside a paragraph stays a span", "text $$a+b$$ here\n", `<span class="math math-display">a+b</span>`},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := r.RenderInline([]byte(tt.src), "docs/x.md")
			require.NoError(t, err)
			assert.Contains(t, withoutSourceRanges(string(out)), tt.want)
		})
	}
}

func TestMathDollarsInCodeAreNeverTouched(t *testing.T) {
	tests := []struct{ name, src string }{
		{"fence", "```bash\nexport PATH=\"$HOME/bin:$PATH\"\necho $1 $2\n```\n"},
		{"indented code", "    echo $1 $2 $HOME\n"},
		{"code span", "`$x$` и `$HOME`\n"},
		{"mermaid fence", "```mermaid\ngraph TD; A[$x$] --> B;\n```\n"},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := r.RenderInline([]byte(tt.src), "docs/x.md")
			require.NoError(t, err)
			assert.NotContains(t, string(out), `class="math`, "output: %s", out)
		})
	}
}

func TestMathBlockDoesNotInterruptAParagraph(t *testing.T) {
	// act
	out, err := New(Options{}).RenderInline([]byte("строка текста\n$$\nx\n$$\n"), "docs/x.md")

	// assert
	require.NoError(t, err)
	assert.NotContains(t, string(out), `class="math`)
}
