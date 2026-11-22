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

var reHTMLTag = regexp.MustCompile(`</?[a-zA-Z][^>]*>`)

var reFootnoteID = regexp.MustCompile(`^fn(ref)?-\d`)

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
