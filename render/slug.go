// Package render turns a page's markdown into sanitized HTML: heading
// anchors that survive Cyrillic, links rewritten onto the app routes, a table
// of contents and server-side syntax highlighting.
package render

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"golang.org/x/text/unicode/norm"
)

// reHTMLTag matches a tag so a heading that swallowed a raw <a name='x'></a>
// does not leak "a namex a" into its own anchor.
var reHTMLTag = regexp.MustCompile(`</?[a-zA-Z][^>]*>`)

// reFootnoteID matches the anchors footnote.go owns. GitHub keeps them apart
// from document anchors with a "user-content-" prefix on everything the author
// wrote; the frontend contract fixes the plain names here, so the namespace is
// reserved from the other side instead and a heading called "fn-1" is given
// "fn-1-1". Raw HTML can still write the id by hand, exactly as it can write
// any other id the app uses.
var reFootnoteID = regexp.MustCompile(`^fn(ref)?-\d`)

// Slug builds a heading anchor: NFC, drop every rune outside letters, digits,
// "_", "-" and space, trim spaces, turn the remaining spaces into "-", then
// lowercase. This is what GitHub and pymdownx.slugs.slugify(case='lower') both
// do, and the corpus was published with the latter.
//
// Runs of hyphens are deliberately kept: "диск — это" has to stay
// "диск--это", because the em dash disappears and both of its spaces become
// hyphens. Collapsing them would break the published anchors.
func Slug(text string) string {
	var b strings.Builder
	b.Grow(len(text))
	for _, r := range norm.NFC.String(reHTMLTag.ReplaceAllString(text, "")) {
		switch {
		case unicode.IsLetter(r) || unicode.IsNumber(r):
			b.WriteRune(unicode.ToLower(r))
		case r == '_' || r == '-' || r == ' ':
			b.WriteRune(r)
		}
	}
	return strings.ReplaceAll(strings.Trim(b.String(), " "), " ", "-")
}

// slugIDs is a parser.IDs that keeps non-ASCII letters. goldmark's own
// implementation drops every multi-byte rune, which turns a whole Russian
// document into "heading", "heading-1", "heading-2".
//
// It is stateful per document, so a fresh one goes into every parser.Context.
type slugIDs struct {
	used map[string]int
}

func newSlugIDs() parser.IDs {
	return &slugIDs{used: make(map[string]int)}
}

func (s *slugIDs) Generate(value []byte, kind ast.NodeKind) []byte {
	slug := Slug(string(value))
	if slug == "" {
		slug = "section"
		if kind != ast.KindHeading {
			slug = "id"
		}
	}
	return []byte(s.unique(slug))
}

func (s *slugIDs) Put(value []byte) {
	s.used[string(value)] = 0
}

// unique appends -1, -2, ... until the anchor is free, remembering the last
// suffix tried for a base so a document with many repeats stays linear.
func (s *slugIDs) unique(base string) string {
	if _, taken := s.used[base]; !taken && !reFootnoteID.MatchString(base) {
		s.used[base] = 0
		return base
	}
	for i := s.used[base] + 1; ; i++ {
		cand := base + "-" + strconv.Itoa(i)
		if _, taken := s.used[cand]; !taken {
			s.used[base] = i
			s.used[cand] = 0
			return cand
		}
	}
}
