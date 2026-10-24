package search

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"html/template"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

type Mode string

const (
	ModeFuzzy Mode = "fuzzy"
	ModeExact Mode = "exact"
)

const (
	MaxPattern        = 1 << 10
	maxLinesPerResult = 20
	maxMatchedLines   = 5000
	checkEvery        = 1000

	minTypoRunes = 4
	maxTypoTerms = 50

	lineWindowRunes = 200
	lineLeadRunes   = 60
)

var ErrPattern = errors.New("bad pattern")

type Query struct {
	Text              string
	Mode              Mode
	Case, Word, Regex bool
	TitlesOnly        bool
}

type Span struct {
	Text string
	Hit  bool
}

type Line struct {
	Line  int
	Spans []Span
}

type FindQuery struct {
	Text              string
	Case, Word, Regex bool
}

type Result struct {
	Path       string
	Title      string
	TitleSpans []Span
	Score      float64
	MatchCount int
	LineCount  int
	Lines      []Line
	Snippet    template.HTML
	Find       FindQuery
}

type Found struct {
	Results   []Result
	Truncated bool
}

func (ix *Index) Find(ctx context.Context, q Query, limit int) (Found, error) {
	if limit <= 0 || strings.TrimSpace(q.Text) == "" {
		return Found{}, nil
	}
	if q.Mode == ModeExact || q.Regex {
		re, err := compileQuery(q)
		if err != nil {
			return Found{}, err
		}
		return ix.scan(ctx, q, re, limit), nil
	}
	ix.ensureVocab()
	return ix.fuzzy(q, limit), nil
}

func compileQuery(q Query) (*regexp.Regexp, error) {
	if len(q.Text) > MaxPattern {
		return nil, fmt.Errorf("%w: longer than %d bytes", ErrPattern, MaxPattern)
	}
	pattern := normalize(q.Text)
	if !q.Regex {
		pattern = regexp.QuoteMeta(pattern)
	}
	if !q.Case {
		pattern = "(?i)" + pattern
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrPattern, err)
	}
	return re, nil
}

func (ix *Index) fuzzy(q Query, limit int) Found {
	parsed := parseQuery(q.Text, true)
	if len(parsed.terms) == 0 {
		return Found{}
	}

	ix.mu.RLock()
	defer ix.mu.RUnlock()

	slots := make([]slot, len(parsed.terms))
	for k := range parsed.terms {
		s, ok := ix.slotFor(parsed.terms[k])
		if !ok {
			s, ok = ix.typoSlot(&parsed.terms[k])
		}
		if !ok {
			return Found{}
		}
		if q.TitlesOnly {
			s = inTitles(s)
			if len(s.list) == 0 {
				return Found{}
			}
		}
		slots[k] = s
	}

	top := ix.top(parsed, slots, limit, q.TitlesOnly)
	res := Found{Results: make([]Result, 0, len(top))}
	for _, cand := range top {
		res.Results = append(res.Results, cand.doc.fuzzyResult(parsed.terms, cand, q.TitlesOnly))
	}
	return res
}

func (ix *Index) typoSlot(term *queryTerm) (slot, bool) {
	if utf8.RuneCountInString(term.text) < minTypoRunes {
		return slot{}, false
	}
	found := make([]string, 0, 4)
	for _, cand := range ix.vocab {
		if oneEdit(term.text, cand) {
			found = append(found, cand)
			if len(found) == maxTypoTerms {
				break
			}
		}
	}
	if len(found) == 0 {
		return slot{}, false
	}
	term.typo, term.prefix = true, false
	res := ix.mergeTerms(term.text, found)
	return res, len(res.list) > 0
}

func inTitles(s slot) slot {
	res := slot{}
	for i, p := range s.list {
		if p.counts[fieldTitle] == 0 {
			continue
		}
		res.list = append(res.list, p)
		if i < len(s.exact) {
			res.exact = append(res.exact, s.exact[i])
		}
	}
	return res
}

func oneEdit(a, b string) bool {
	if a == b || len(a)-len(b) > utf8.UTFMax || len(b)-len(a) > utf8.UTFMax {
		return false
	}
	ra, rb := []rune(a), []rune(b)
	if len(ra) > len(rb) {
		ra, rb = rb, ra
	}
	if len(rb)-len(ra) > 1 {
		return false
	}
	i := 0
	for i < len(ra) && ra[i] == rb[i] {
		i++
	}
	if len(ra) == len(rb) {
		return string(ra[i+1:]) == string(rb[i+1:])
	}
	return string(ra[i:]) == string(rb[i+1:])
}

func (d *document) fuzzyResult(terms []queryTerm, cand topDoc, titlesOnly bool) Result {
	marks := d.matches(terms, cand.match)
	snippet, _ := d.snippetOf(marks)
	res := Result{
		Path:       d.path,
		Title:      d.title,
		TitleSpans: titleSpans(d.title, terms),
		Score:      cand.score,
		Snippet:    snippet,
		Find:       FindQuery{Text: d.matchedWords(marks), Word: true, Regex: true},
	}
	if titlesOnly {
		res.MatchCount = hitCount(res.TitleSpans)
		return res
	}
	res.MatchCount = len(marks)
	res.Lines, res.LineCount = d.linesOf(marks)
	return res
}

func (d *document) matchedWords(marks []mark) string {
	seen := map[string]bool{}
	words := make([]string, 0, 4)
	for _, m := range marks {
		word := findWordAt(d.plain, int(m.start))
		key := strings.ToLower(word)
		if word == "" || seen[key] {
			continue
		}
		seen[key] = true
		words = append(words, regexp.QuoteMeta(word))
	}
	return strings.Join(words, "|")
}

func findWordAt(text string, at int) string {
	start := at
	for start > 0 {
		r, size := utf8.DecodeLastRuneInString(text[:start])
		if !isWordChar(r) && !ignorable(r) {
			break
		}
		start -= size
	}
	end := at
	for end < len(text) {
		r, size := utf8.DecodeRuneInString(text[end:])
		if !isWordChar(r) && !ignorable(r) {
			break
		}
		end += size
	}
	return text[start:end]
}

func titleSpans(title string, terms []queryTerm) []Span {
	text := normalize(title)
	marks := make([]mark, 0, 2)
	for _, tok := range tokenize(text) {
		for k, wanted := range terms {
			if !termMatches(wanted, tok.term) {
				continue
			}
			end := wordEndAt(text, tok.off)
			marks = append(marks, mark{start: off32(tok.off), end: off32(end), term: k})
			break
		}
	}
	return spansOf(text, marks)
}

func termMatches(term queryTerm, word string) bool {
	switch {
	case term.typo:
		return oneEdit(term.text, word)
	case term.prefix:
		return strings.HasPrefix(word, term.text)
	}
	return word == term.text
}

func spansOf(text string, marks []mark) []Span {
	res := make([]Span, 0, len(marks)*2+1)
	prev := 0
	for _, m := range marks {
		if int(m.start) < prev || int(m.end) > len(text) || m.end <= m.start {
			continue
		}
		if int(m.start) > prev {
			res = append(res, Span{Text: text[prev:m.start]})
		}
		res = append(res, Span{Text: text[m.start:m.end], Hit: true})
		prev = int(m.end)
	}
	if prev < len(text) {
		res = append(res, Span{Text: text[prev:]})
	}
	return res
}

func (d *document) lineOf(off int32) int {
	i, ok := slices.BinarySearchFunc(d.lines, off, func(m lineMark, off int32) int {
		return cmp.Compare(m.off, off)
	})
	if !ok {
		i--
	}
	return max(i, 0)
}

func (d *document) lineBounds(i int) (int, int) {
	start := int(d.lines[i].off)
	end := strings.IndexByte(d.plain[start:], '\n')
	if end < 0 {
		return start, len(d.plain)
	}
	return start, start + end
}

func (d *document) linesOf(marks []mark) ([]Line, int) {
	if len(d.lines) == 0 {
		return nil, 0
	}
	res := make([]Line, 0, min(len(marks), maxLinesPerResult))
	count := 0
	for i := 0; i < len(marks); {
		at := d.lineOf(marks[i].start)
		start, end := d.lineBounds(at)
		j := i
		for j < len(marks) && int(marks[j].start) < end {
			j++
		}
		count++
		if len(res) < maxLinesPerResult {
			res = append(res, Line{Line: int(d.lines[at].line), Spans: cutLine(d.plain[start:end], shift(marks[i:j], start))})
		}
		i = j
	}
	return res, count
}

func shift(marks []mark, start int) []mark {
	res := make([]mark, 0, len(marks))
	for _, m := range marks {
		res = append(res, mark{start: m.start - off32(start), end: m.end - off32(start), term: m.term})
	}
	return res
}

func cutLine(line string, marks []mark) []Span {
	if utf8.RuneCountInString(line) <= lineWindowRunes || len(marks) == 0 {
		return spansOf(line, marks)
	}
	start := retreatRunes(line, int(marks[0].start), lineLeadRunes)
	end := max(advanceRunes(line, start, lineWindowRunes), int(marks[0].end))
	inside := make([]mark, 0, len(marks))
	for _, m := range marks {
		if int(m.start) >= start && int(m.end) <= end {
			inside = append(inside, m)
		}
	}
	res := spansOf(line[start:end], shift(inside, start))
	if start > 0 {
		res = append([]Span{{Text: ellipsis}}, res...)
	}
	if end < len(line) {
		res = append(res, Span{Text: ellipsis})
	}
	return res
}

func (ix *Index) scan(ctx context.Context, q Query, re *regexp.Regexp, limit int) Found {
	ix.mu.RLock()
	defer ix.mu.RUnlock()

	byPath := make([]*document, 0, len(ix.docs))
	for _, entry := range ix.docs {
		byPath = append(byPath, entry)
	}
	slices.SortFunc(byPath, func(a, b *document) int { return strings.Compare(a.path, b.path) })

	res := Found{}
	matched, read := 0, 0
	find := FindQuery{Text: q.Text, Case: q.Case, Word: q.Word, Regex: q.Regex}
	for _, doc := range byPath {
		if ctx.Err() != nil || matched >= maxMatchedLines {
			res.Truncated = true
			break
		}
		title := normalize(doc.title)
		titleMarks := patternMarks(title, re, q.Word)
		result := Result{Path: doc.path, Title: doc.title, TitleSpans: spansOf(title, titleMarks), Find: find}
		if q.TitlesOnly {
			if len(titleMarks) > 0 {
				result.MatchCount = hitCount(result.TitleSpans)
				result.Snippet = doc.firstSnippet(ctx, re, q.Word)
				res.Results = append(res.Results, result)
			}
			continue
		}
		stopped := doc.scanLines(ctx, re, q.Word, &result, &matched, &read)
		if result.MatchCount > 0 || len(titleMarks) > 0 {
			res.Results = append(res.Results, result)
		}
		if stopped {
			res.Truncated = true
			break
		}
	}

	slices.SortStableFunc(res.Results, func(a, b Result) int {
		ta, tb := hasHit(a.TitleSpans), hasHit(b.TitleSpans)
		if ta != tb {
			if ta {
				return -1
			}
			return 1
		}
		if c := cmp.Compare(b.MatchCount, a.MatchCount); c != 0 {
			return c
		}
		return strings.Compare(a.Path, b.Path)
	})
	if len(res.Results) > limit {
		res.Results = res.Results[:limit]
	}
	return res
}

func (d *document) scanLines(ctx context.Context, re *regexp.Regexp, word bool, res *Result, matched, read *int) bool {
	var first []mark
	firstStart := 0
	for i := range d.lines {
		*read++
		if *read%checkEvery == 0 && ctx.Err() != nil {
			return true
		}
		start, end := d.lineBounds(i)
		marks := patternMarks(d.plain[start:end], re, word)
		if len(marks) == 0 {
			continue
		}
		if first == nil {
			first, firstStart = marks, start
		}
		res.MatchCount += len(marks)
		res.LineCount++
		*matched++
		if len(res.Lines) < maxLinesPerResult {
			res.Lines = append(res.Lines, Line{Line: int(d.lines[i].line), Spans: cutLine(d.plain[start:end], marks)})
		}
		if *matched >= maxMatchedLines {
			break
		}
	}
	if first != nil {
		res.Snippet = d.snippetAt(shift(first, -firstStart))
	} else {
		res.Snippet = d.lead()
	}
	return *matched >= maxMatchedLines
}

func (d *document) firstSnippet(ctx context.Context, re *regexp.Regexp, word bool) template.HTML {
	for i := range d.lines {
		if (i+1)%checkEvery == 0 && ctx.Err() != nil {
			break
		}
		start, end := d.lineBounds(i)
		if marks := patternMarks(d.plain[start:end], re, word); len(marks) > 0 {
			return d.snippetAt(shift(marks, -start))
		}
	}
	return d.lead()
}

func patternMarks(text string, re *regexp.Regexp, word bool) []mark {
	res := []mark{}
	for _, loc := range re.FindAllStringIndex(text, -1) {
		if loc[1] <= loc[0] {
			continue
		}
		if word && !wordBounded(text, loc[0], loc[1]) {
			continue
		}
		res = append(res, mark{start: off32(loc[0]), end: off32(loc[1])})
	}
	return res
}

func wordBounded(text string, start, end int) bool {
	if start > 0 {
		if r, _ := utf8.DecodeLastRuneInString(text[:start]); isWordChar(r) {
			return false
		}
	}
	if end < len(text) {
		if r, _ := utf8.DecodeRuneInString(text[end:]); isWordChar(r) {
			return false
		}
	}
	return true
}

func isWordChar(r rune) bool {
	return r == '_' || unicode.IsLetter(r) || unicode.IsNumber(r)
}

func hasHit(spans []Span) bool {
	return slices.ContainsFunc(spans, func(s Span) bool { return s.Hit })
}

func hitCount(spans []Span) int {
	res := 0
	for _, piece := range spans {
		if piece.Hit {
			res++
		}
	}
	return res
}
