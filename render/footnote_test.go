package render

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFootnoteShape(t *testing.T) {
	// act
	out, err := New(Options{}).RenderInline([]byte("Текст[^a].\n\n[^a]: сноска\n"), "docs/x.md")

	// assert
	require.NoError(t, err)
	assert.Equal(t, "<p>Текст<sup class=\"footnote-ref\"><a href=\"#fn-1\" id=\"fnref-1\">1</a></sup>.</p>\n"+
		"<section class=\"footnotes\">\n<ol>\n<li id=\"fn-1\">\n"+
		"<p>сноска <a href=\"#fnref-1\" class=\"footnote-back\">↩</a></p>\n"+
		"</li>\n</ol>\n</section>\n", string(out))
}

// TestFootnoteNumbersFollowFirstReference is GitHub's documented rule: the
// position of a definition does not decide the number.
func TestFootnoteNumbersFollowFirstReference(t *testing.T) {
	// act
	out, err := New(Options{}).RenderInline(
		[]byte("Сначала[^b], потом[^a].\n\n[^a]: первая по определению\n[^b]: вторая по определению\n"),
		"docs/x.md")

	// assert
	require.NoError(t, err)
	assert.Contains(t, string(out), `Сначала<sup class="footnote-ref"><a href="#fn-1" id="fnref-1">1</a></sup>`)
	assert.Contains(t, string(out), `потом<sup class="footnote-ref"><a href="#fn-2" id="fnref-2">2</a></sup>`)
	assert.Contains(t, string(out), "<li id=\"fn-1\">\n<p>вторая по определению")
}

func TestFootnoteRepeatedReferenceGetsItsOwnBacklink(t *testing.T) {
	// act
	out, err := New(Options{}).RenderInline([]byte("Раз[^1] и два[^1].\n\n[^1]: сноска\n"), "docs/x.md")

	// assert
	require.NoError(t, err)
	assert.Contains(t, string(out), `id="fnref-1">1</a></sup> и два<sup class="footnote-ref"><a href="#fn-1" id="fnref-1-2">1</a>`)
	assert.Contains(t, string(out), `<a href="#fnref-1" class="footnote-back">↩</a>`)
	assert.Contains(t, string(out), `<a href="#fnref-1-2" class="footnote-back">↩<sup>2</sup></a>`)
}

// TestFootnoteAnchorsCannotBeStolenByAHeading covers a document that names its
// headings after the footnote anchors: the headings have to give way, or the
// footnote links would jump to them instead.
func TestFootnoteAnchorsCannotBeStolenByAHeading(t *testing.T) {
	// act
	res, err := New(Options{}).Render([]byte("# fn-1\n\n## fnref-1\n\nТекст[^1].\n\n[^1]: сноска\n"), "docs/x.md")

	// assert
	require.NoError(t, err)
	assert.Equal(t, []Heading{{Level: 1, Text: "fn-1", ID: "fn-1-1"}, {Level: 2, Text: "fnref-1", ID: "fnref-1-1"}}, res.TOC)
	assert.Contains(t, string(res.HTML), `<li id="fn-1">`)
	assert.Contains(t, string(res.HTML), `id="fnref-1">1</a>`)
}
