package search

import (
	"regexp"
	"slices"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

const (
	maxTermRunes      = 40
	maxDigitTermRunes = 10
)

const (
	softHyphen         = '\u00ad'
	zeroWidthSpace     = '\u200b'
	zeroWidthNonJoiner = '\u200c'
	zeroWidthJoiner    = '\u200d'
	byteOrderMark      = '\ufeff'
)

type token struct {
	term string
	off  int
}

func normalize(s string) string {
	return norm.NFC.String(s)
}

const (
	firstAccented = 0xc0
	lastAccented  = 0x2fff
	ownLetters    = "йЙїЇўЎ"
)

type accentTable struct {
	base     map[rune]rune
	variants map[rune][]rune
}

var accents = sync.OnceValue(func() accentTable {
	res := accentTable{base: make(map[rune]rune), variants: make(map[rune][]rune)}
	for r := rune(firstAccented); r <= lastAccented; r++ {
		if !unicode.IsLetter(r) || strings.ContainsRune(ownLetters, r) {
			continue
		}
		parts := []rune(norm.NFD.String(string(r)))
		if len(parts) < 2 || !allMarks(parts[1:]) {
			continue
		}
		base := unicode.ToLower(parts[0])
		res.base[r] = base
		res.variants[base] = append(res.variants[base], r)
	}
	for base, list := range res.variants {
		list = append(list, base)
		slices.Sort(list)
		res.variants[base] = slices.Compact(list)
	}
	return res
})

func allMarks(runes []rune) bool {
	for _, r := range runes {
		if !unicode.Is(unicode.Mn, r) {
			return false
		}
	}
	return true
}

func fold(r rune) rune {
	if base, ok := accents().base[r]; ok {
		return base
	}
	return unicode.ToLower(r)
}

func accentFree(text string) string {
	var b strings.Builder
	for _, r := range text {
		switch {
		case unicode.Is(unicode.Mn, r):
		case !unicode.IsLetter(r):
			b.WriteString(regexp.QuoteMeta(string(r)))
		default:
			b.WriteString(letterClass(r))
			b.WriteString(`\p{Mn}*`)
		}
	}
	return b.String()
}

func letterClass(r rune) string {
	variants := accents().variants[fold(r)]
	if len(variants) == 0 {
		return regexp.QuoteMeta(string(r))
	}
	return "[" + string(variants) + "]"
}

func ignorable(r rune) bool {
	switch r {
	case softHyphen, zeroWidthSpace, zeroWidthNonJoiner, zeroWidthJoiner, byteOrderMark:
		return true
	}
	return unicode.Is(unicode.Mn, r)
}

func wordRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsNumber(r)
}

func tokenize(text string) []token {
	res := make([]token, 0, len(text)/8+1)
	var term strings.Builder
	start := -1

	flush := func() {
		if start < 0 {
			return
		}
		if t := term.String(); acceptTerm(t) {
			res = append(res, token{term: t, off: start})
		}
		term.Reset()
		start = -1
	}

	for i, r := range text {
		switch {
		case ignorable(r):
		case wordRune(r):
			if start < 0 {
				start = i
			}
			term.WriteRune(fold(r))
		default:
			flush()
		}
	}
	flush()
	return res
}

func acceptTerm(term string) bool {
	n := utf8.RuneCountInString(term)
	if n == 0 || n > maxTermRunes {
		return false
	}
	return n <= maxDigitTermRunes || !allDigits(term)
}

func allDigits(term string) bool {
	for _, r := range term {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

func matchTerm(text string, term queryTerm, at int) int {
	if term.typo {
		return wordEndAt(text, at)
	}
	if term.prefix {
		return matchPrefixAt(text, term.text, at)
	}
	return matchAt(text, term.text, at)
}

func matchAt(text, term string, at int) int {
	i := matchRunes(text, term, at)
	if i < 0 {
		return -1
	}

	i = skipIgnorable(text, i)
	if i < len(text) {
		if r, _ := utf8.DecodeRuneInString(text[i:]); wordRune(r) {
			return -1
		}
	}
	return i
}

func matchPrefixAt(text, term string, at int) int {
	i := matchRunes(text, term, at)
	if i < 0 {
		return -1
	}
	return wordEndAt(text, i)
}

func wordEndAt(text string, at int) int {
	if at < 0 || at > len(text) {
		return -1
	}
	i := at
	for i < len(text) {
		r, size := utf8.DecodeRuneInString(text[i:])
		if !wordRune(r) && !ignorable(r) {
			break
		}
		i += size
	}
	return i
}

func matchRunes(text, term string, at int) int {
	if at < 0 || at > len(text) {
		return -1
	}
	if term == "" {
		return at
	}

	i, ti := at, 0
	for ti < len(term) {
		if i >= len(text) {
			return -1
		}
		r, size := utf8.DecodeRuneInString(text[i:])
		i += size
		if ignorable(r) {
			continue
		}
		tr, tsize := utf8.DecodeRuneInString(term[ti:])
		if fold(r) != tr {
			return -1
		}
		ti += tsize
	}
	return i
}

func skipIgnorable(text string, at int) int {
	for at < len(text) {
		r, size := utf8.DecodeRuneInString(text[at:])
		if !ignorable(r) {
			break
		}
		at += size
	}
	return at
}

func skipGap(text string, at int) int {
	breaks := 0
	for i := at; i < len(text); {
		r, size := utf8.DecodeRuneInString(text[i:])
		if wordRune(r) {
			return i
		}
		if r == '\n' {
			breaks++
			if breaks > 1 {
				return -1
			}
		}
		i += size
	}
	return -1
}

func phraseAt(text string, terms []string, at int) bool {
	pos := at
	for i, term := range terms {
		if i > 0 {
			if pos = skipGap(text, pos); pos < 0 {
				return false
			}
		}
		end := matchAt(text, term, pos)
		if end < 0 {
			return false
		}
		pos = end
	}
	return true
}

func advanceRunes(text string, at, n int) int {
	i := at
	for range n {
		if i >= len(text) {
			break
		}
		_, size := utf8.DecodeRuneInString(text[i:])
		i += size
	}
	return i
}

func retreatRunes(text string, at, n int) int {
	i := at
	for range n {
		if i <= 0 {
			break
		}
		_, size := utf8.DecodeLastRuneInString(text[:i])
		i -= size
	}
	return i
}

func cutBytes(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}
