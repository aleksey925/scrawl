// Package search keeps an in-memory full-text index of markdown documents.
// The caller feeds it documents, so the package never touches the filesystem.
package search

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

const (
	// terms longer than this are hashes, base64 blobs or ascii art, never
	// something a person types into a search box
	maxTermRunes = 40
	// long digit runs are ids and timestamps that only bloat the vocabulary
	maxDigitTermRunes = 10
)

// invisible characters that must disappear instead of splitting a word: they
// come from copy-pasted web pages and sit in the middle of real words.
const (
	softHyphen         = '\u00ad'
	zeroWidthSpace     = '\u200b'
	zeroWidthNonJoiner = '\u200c'
	zeroWidthJoiner    = '\u200d'
	byteOrderMark      = '\ufeff'
)

// token is one indexable term with the byte offset it starts at in the text it
// was taken from.
type token struct {
	term string
	off  int
}

// normalize brings text to NFC so that a combining accent typed or pasted
// separately composes with its base letter and matches the same word written
// as a single rune.
func normalize(s string) string {
	return norm.NFC.String(s)
}

// fold maps a rune to the form the index stores. Russian writers use ё and е
// interchangeably and expect them to match; nothing in the standard library or
// in x/text unifies the two, so it has to be done here.
func fold(r rune) rune {
	r = unicode.ToLower(r)
	if r == 'ё' {
		return 'е'
	}
	return r
}

// ignorable reports whether a rune carries no meaning for matching and must be
// skipped without ending the current word. Combining marks land here too: NFC
// leaves the ones that compose with nothing, such as the Russian stress accent.
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

// tokenize splits NFC text into folded terms with their byte offsets.
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

// matchTerm matches one query term against text at byte offset at and returns
// the offset just past the match, or -1.
func matchTerm(text string, term queryTerm, at int) int {
	if term.prefix {
		return matchPrefixAt(text, term.text, at)
	}
	return matchAt(text, term.text, at)
}

// matchAt matches an already folded term against text at byte offset at,
// ignoring the invisible characters inside it, and returns the offset just
// past the match or -1. The match must end on a word boundary, so the index
// and the highlighter agree on what a term is.
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

// matchPrefixAt matches a term that only has to start the word at at, and
// returns the offset past the whole word. The rest of the word comes along so
// a snippet highlights "копирование" for a reader who typed "копир".
func matchPrefixAt(text, term string, at int) int {
	i := matchRunes(text, term, at)
	if i < 0 {
		return -1
	}

	for i < len(text) {
		r, size := utf8.DecodeRuneInString(text[i:])
		if !wordRune(r) && !ignorable(r) {
			break
		}
		i += size
	}
	return i
}

// matchRunes consumes the runes of term in text starting at at.
func matchRunes(text, term string, at int) int {
	if at < 0 || at > len(text) || term == "" {
		return -1
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

// skipGap advances over the characters between two phrase terms and returns
// -1 when the gap crosses a block boundary, which the analyzer marks with a
// blank line. Hard-wrapped prose still works: one line break stays inside the
// same block.
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

// phraseAt reports whether the terms follow each other in text starting at at,
// separated by nothing but non-word characters. That makes a phrase typed with
// plain spaces match text glued together with a non-breaking space, a line
// break or punctuation.
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

// advanceRunes returns the offset n runes after at, clamped to the end.
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

// retreatRunes returns the offset n runes before at, clamped to the start.
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

// cutBytes truncates s to at most n bytes without splitting a rune.
func cutBytes(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}
