package search

import (
	"cmp"
	"html/template"
	"math"
	"math/bits"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	// how much text a snippet shows, and how much of it comes before the first
	// match so the reader sees the term in context
	snippetRunes = 160
	snippetLead  = 50

	// a window opening inside a code fence loses against any window in prose
	codePenalty = 1000

	// a document made of one repeated word would otherwise make window picking
	// quadratic; the best window is always among the first matches anyway
	maxSnippetMarks = 1000

	ellipsis = "…"
)

// mark is one matched term inside the plain text of a document.
type mark struct {
	start, end int32
	term       int
}

// snippet returns the best window of the document with every matched term
// wrapped in <mark>, plus the source line the window starts at.
func (d *document) snippet(terms []queryTerm, match []*posting) (template.HTML, int) {
	marks := d.matches(terms, match)
	if len(marks) == 0 {
		return d.lead(), 1
	}

	best := marks[d.bestWindow(marks)]
	start, end := d.window(best)

	inside := make([]mark, 0, 8)
	for _, m := range marks {
		if int(m.start) >= start && int(m.end) <= end {
			inside = append(inside, mark{start: m.start - off32(start), end: m.end - off32(start), term: m.term})
		}
	}

	text, spans := collapseWindow(d.plain[start:end], inside)
	return renderSnippet(text, spans, cutBefore(d.plain, start), cutAfter(d.plain, end)), d.lineAt(best.start)
}

// lead is the snippet of a document matched only through its title.
func (d *document) lead() template.HTML {
	end := wordEnd(d.plain, advanceRunes(d.plain, 0, snippetRunes), 0)
	text, _ := collapseWindow(d.plain[:end], nil)
	return renderSnippet(text, nil, false, cutAfter(d.plain, end))
}

// matches lists every occurrence of every query term in document order,
// without overlaps so the renderer can never slice a string backwards.
func (d *document) matches(terms []queryTerm, match []*posting) []mark {
	res := make([]mark, 0, 16)
	for k, p := range match {
		for _, off := range p.offs {
			if end := matchTerm(d.plain, terms[k], int(off)); end > int(off) {
				res = append(res, mark{start: off, end: off32(end), term: k})
			}
		}
	}
	slices.SortFunc(res, func(a, b mark) int { return cmp.Compare(a.start, b.start) })

	out := res[:0]
	var prev int32
	for _, m := range res {
		if m.start < prev {
			continue
		}
		out = append(out, m)
		prev = m.end
	}
	if len(out) > maxSnippetMarks {
		out = out[:maxSnippetMarks]
	}
	return out
}

// bestWindow picks the mark the snippet should open on: most distinct terms
// first, prose before code, earliest position on a tie.
func (d *document) bestWindow(marks []mark) int {
	want := 0
	for _, m := range marks {
		want = max(want, m.term+1)
	}

	best, bestScore := 0, math.Inf(-1)
	for i := range marks {
		end := off32(advanceRunes(d.plain, int(marks[i].start), snippetRunes))
		var seen uint64
		count := 0
		for j := i; j < len(marks) && marks[j].start < end; j++ {
			seen |= 1 << (marks[j].term % 64)
			count++
		}

		distinct := bits.OnesCount64(seen)
		cur := float64(distinct*4 + count)
		if d.inCode(marks[i].start) {
			cur -= codePenalty
		}
		if cur > bestScore {
			best, bestScore = i, cur
		}
		if distinct == want && !d.inCode(marks[i].start) {
			break
		}
	}
	return best
}

// window returns the byte range to show around a match, cut at word boundaries.
func (d *document) window(m mark) (start, end int) {
	start = wordStart(d.plain, retreatRunes(d.plain, int(m.start), snippetLead), int(m.start))
	end = max(advanceRunes(d.plain, start, snippetRunes), int(m.end))
	return start, wordEnd(d.plain, end, int(m.end))
}

func (d *document) inCode(off int32) bool {
	_, ok := slices.BinarySearchFunc(d.code, off, func(s span, off int32) int {
		if s.end <= off {
			return -1
		}
		if s.start > off {
			return 1
		}
		return 0
	})
	return ok
}

// lineAt maps an offset of the plain text back to its line in the markdown.
func (d *document) lineAt(off int32) int {
	i, ok := slices.BinarySearchFunc(d.lines, off, func(m lineMark, off int32) int {
		return cmp.Compare(m.off, off)
	})
	if !ok {
		i--
	}
	if i < 0 || i >= len(d.lines) {
		return 1
	}
	return int(d.lines[i].line)
}

// cutBefore reports whether text was dropped in front of the window.
func cutBefore(plain string, start int) bool {
	return start > 0 && strings.TrimSpace(plain[:start]) != ""
}

// cutAfter reports whether text was dropped after the window.
func cutAfter(plain string, end int) bool {
	return end < len(plain) && strings.TrimSpace(plain[end:]) != ""
}

// wordStart moves at forward out of the word it landed in, never past limit.
func wordStart(text string, at, limit int) int {
	if at <= 0 {
		return 0
	}
	if r, _ := utf8.DecodeLastRuneInString(text[:at]); wordRune(r) {
		for at < limit {
			r, size := utf8.DecodeRuneInString(text[at:])
			if !wordRune(r) {
				break
			}
			at += size
		}
	}
	for at < limit {
		r, size := utf8.DecodeRuneInString(text[at:])
		if !unicode.IsSpace(r) {
			break
		}
		at += size
	}
	return at
}

// wordEnd moves at back to the end of the last whole word, never before least.
func wordEnd(text string, at, least int) int {
	if at >= len(text) {
		return len(text)
	}
	if r, _ := utf8.DecodeRuneInString(text[at:]); !wordRune(r) {
		return at
	}
	for at > least {
		r, size := utf8.DecodeLastRuneInString(text[:at])
		if !wordRune(r) {
			break
		}
		at -= size
	}
	return at
}

// collapseWindow squeezes every whitespace run in text into a single space and
// returns the marks moved onto the squeezed copy.
func collapseWindow(text string, marks []mark) (string, []mark) {
	var b strings.Builder
	b.Grow(len(text))

	out := make([]mark, 0, len(marks))
	next, space := 0, false
	openStart, openEnd, openTerm := int32(-1), 0, 0

	for i, r := range text {
		if openStart >= 0 && i >= openEnd {
			out = append(out, mark{start: openStart, end: off32(b.Len()), term: openTerm})
			openStart = -1
		}
		if unicode.IsSpace(r) {
			space = true
			continue
		}

		space = writeSpace(&b, space)
		for next < len(marks) && i >= int(marks[next].start) {
			if openStart < 0 {
				openStart, openEnd, openTerm = off32(b.Len()), int(marks[next].end), marks[next].term
			}
			next++
		}
		b.WriteRune(r)
	}
	if openStart >= 0 {
		out = append(out, mark{start: openStart, end: off32(b.Len()), term: openTerm})
	}
	return b.String(), out
}

// writeSpace flushes a pending whitespace run, dropping it at the very start.
func writeSpace(b *strings.Builder, pending bool) bool {
	if pending && b.Len() > 0 {
		b.WriteByte(' ')
	}
	return false
}

// renderSnippet escapes the text and wraps every match in <mark>. The result
// goes straight into a page, so nothing but the mark tags may survive here.
func renderSnippet(text string, marks []mark, lead, tail bool) template.HTML {
	var b strings.Builder
	if lead {
		b.WriteString(ellipsis)
	}

	prev := 0
	for _, m := range marks {
		if int(m.start) < prev || int(m.end) > len(text) || m.end <= m.start {
			continue
		}
		b.WriteString(template.HTMLEscapeString(text[prev:m.start]))
		b.WriteString("<mark>")
		b.WriteString(template.HTMLEscapeString(text[m.start:m.end]))
		b.WriteString("</mark>")
		prev = int(m.end)
	}
	b.WriteString(template.HTMLEscapeString(text[prev:]))

	if tail {
		b.WriteString(ellipsis)
	}
	return template.HTML(b.String()) //nolint:gosec // every span above is escaped, only the mark tags are ours
}
