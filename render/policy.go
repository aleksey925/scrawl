package render

import (
	"regexp"

	"github.com/microcosm-cc/bluemonday"
)

var (
	// bluemonday's own id filter is not anchored and is ASCII only, so a
	// Cyrillic anchor needs an explicit, anchored pattern.
	reSlugID = regexp.MustCompile(`^[\p{L}\p{N}_][\p{L}\p{N}._:\-]{0,128}$`)
	// the corpus has 249 hand-written anchors such as
	// <a name='Активация-"Quick-Search"-в-synaptic'></a>
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
)

// newPolicy builds the sanitizer for rendered documents. goldmark runs with
// unsafe HTML enabled so hand-written markup reaches this point intact; what
// survives is decided here and nowhere else.
//
// data: URLs are refused everywhere, images included. An inline data:image is
// convenient for a pasted screenshot, but it also carries data:image/svg+xml,
// which is a scriptable document in an <img> and is not worth the trade when
// the app already has /api/upload for pasted images.
func newPolicy() *bluemonday.Policy {
	p := bluemonday.UGCPolicy()

	p.AllowAttrs("id").Matching(reSlugID).Globally()
	p.AllowAttrs("class").Matching(bluemonday.SpaceSeparatedTokens).Globally()
	p.AllowAttrs("role").Matching(reRole).Globally() // goldmark footnotes
	p.AllowAttrs("name").Matching(reAnchorName).OnElements("a")
	p.AllowAttrs("tabindex").Matching(reTabindex).OnElements("pre")
	p.AllowAttrs("data-lang").Matching(reLang).OnElements("div")

	p.AllowElements("details", "summary", "figure", "figcaption",
		"kbd", "mark", "sup", "sub", "dl", "dt", "dd", "input", "hr", "br")
	p.AllowAttrs("open").OnElements("details")

	// GFM task lists
	p.AllowAttrs("type").Matching(reCheckbox).OnElements("input")
	p.AllowAttrs("checked", "disabled").OnElements("input")

	p.AllowImages()
	p.AllowAttrs("loading").Matching(reLoading).OnElements("img")
	p.AllowAttrs("decoding").Matching(reDecoding).OnElements("img")
	p.AllowTables()
	p.AllowLists()
	// AllowLists does not cover start=, and 4 corpus lists open at 2..5
	p.AllowAttrs("start").Matching(reStart).OnElements("ol")
	p.AllowAttrs("align").Matching(reAlign).OnElements("td", "th", "tr", "col")
	p.AllowAttrs("colspan", "rowspan").Matching(reSpan).OnElements("td", "th")

	p.AllowAttrs("target").Matching(reTarget).OnElements("a")
	p.AllowAttrs("rel").Matching(reRel).OnElements("a")

	p.AllowURLSchemes("http", "https", "mailto", "tel")
	p.AllowRelativeURLs(true)
	p.RequireParseableURLs(true)

	// these two have to stay last: AllowImages, AllowTables and AllowLists
	// each call AllowStandardURLs, which turns nofollow back on
	p.RequireNoFollowOnLinks(false)
	p.RequireNoFollowOnFullyQualifiedLinks(true)

	return p
}
