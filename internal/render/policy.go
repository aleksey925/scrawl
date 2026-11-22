package render

import (
	"regexp"

	"github.com/microcosm-cc/bluemonday"
)

var (
	reSlugID     = regexp.MustCompile(`^[\p{L}\p{N}_][\p{L}\p{N}._:\-]{0,128}$`)
	reAnchorName = regexp.MustCompile(`^[^\s<>&]{1,192}$`)
	reLang       = regexp.MustCompile(`^[\p{L}\p{N}+#._-]{1,32}$`)
	reTarget     = regexp.MustCompile(`^_blank$`)
	reRel        = regexp.MustCompile(`^[a-z ]{1,64}$`)
	reAlign      = regexp.MustCompile(`^(left|right|center)$`)
	reSpan       = regexp.MustCompile(`^\d{1,3}$`)
	reStart      = regexp.MustCompile(`^\d{1,9}$`)
	reLoading    = regexp.MustCompile(`^(lazy|eager)$`)
	reDecoding   = regexp.MustCompile(`^(async|sync|auto)$`)
	reCheckbox   = regexp.MustCompile(`^checkbox$`)
	reRole       = regexp.MustCompile(`^[a-z-]{1,32}$`)
	reTabindex   = regexp.MustCompile(`^0$`)
	reSrcLine    = regexp.MustCompile(`^[1-9]\d{0,8}$`)
	reMediaQuery = regexp.MustCompile(`^[a-zA-Z0-9 ()\-:,.]{1,128}$`)
	reMediaType  = regexp.MustCompile(`^image/[a-z0-9.+-]{1,32}$`)
	reSrcset     = regexp.MustCompile(
		`^ *` + srcsetCandidate + `(?: *, *` + srcsetCandidate + `){0,15} *$`)
)

const srcsetCandidate = `(?:https?://[^\s,"'<>]+|[^\s,:"'<>]+)(?: +[0-9]+(?:\.[0-9]+)?[wx])?`

func newPolicy() *bluemonday.Policy {
	p := bluemonday.NewPolicy()

	p.AllowAttrs("id").Matching(reSlugID).Globally()
	p.AllowAttrs("class").Matching(bluemonday.SpaceSeparatedTokens).Globally()
	p.AllowAttrs("role").Matching(reRole).Globally()
	p.AllowAttrs("name").Matching(reAnchorName).OnElements("a")
	p.AllowAttrs("tabindex").Matching(reTabindex).OnElements("pre")
	p.AllowAttrs("data-lang").Matching(reLang).OnElements("div")
	p.AllowAttrs(srcStartAttr, srcEndAttr).Matching(reSrcLine).OnElements(
		"h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "pre",
		"blockquote", "ul", "ol", "li", "hr", "details")

	p.AllowElements("h1", "h2", "h3", "h4", "h5", "h6",
		"p", "div", "span", "blockquote", "pre", "code", "section", "article", "aside")
	p.AllowElements("a", "em", "strong", "b", "i", "u", "s", "strike", "del", "ins",
		"abbr", "cite", "dfn", "q", "samp", "var", "time", "small", "tt", "wbr")
	p.AllowElements("details", "summary", "figure", "figcaption",
		"kbd", "mark", "sup", "sub", "dl", "dt", "dd", "input", "hr", "br")
	p.AllowAttrs("href").OnElements("a")
	p.AllowAttrs("open").OnElements("details")

	p.AllowAttrs("type").Matching(reCheckbox).OnElements("input")
	p.AllowAttrs("checked", "disabled").OnElements("input")

	p.AllowImages()
	p.AllowAttrs("loading").Matching(reLoading).OnElements("img")
	p.AllowAttrs("decoding").Matching(reDecoding).OnElements("img")
	p.AllowElements("picture", "source")
	p.AllowAttrs("srcset").Matching(reSrcset).OnElements("source")
	p.AllowAttrs("media").Matching(reMediaQuery).OnElements("source")
	p.AllowAttrs("type").Matching(reMediaType).OnElements("source")
	p.AllowTables()
	p.AllowLists()
	p.AllowAttrs("start").Matching(reStart).OnElements("ol")
	p.AllowAttrs("align").Matching(reAlign).OnElements("td", "th", "tr", "col")
	p.AllowAttrs("colspan", "rowspan").Matching(reSpan).OnElements("td", "th")

	p.AllowAttrs("target").Matching(reTarget).OnElements("a")
	p.AllowAttrs("rel").Matching(reRel).OnElements("a")

	p.AllowURLSchemes("http", "https", "mailto", "tel")
	p.AllowRelativeURLs(true)
	p.RequireParseableURLs(true)

	p.RequireNoFollowOnLinks(false)
	p.RequireNoFollowOnFullyQualifiedLinks(true)

	return p
}
