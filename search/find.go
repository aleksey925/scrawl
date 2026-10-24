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

// Mode is how the text of a query is matched.
type Mode string

const (
	// ModeFuzzy is the ranked word search: every word required, the last one a
	// prefix, one typo allowed in a word of minTypoRunes and more
	ModeFuzzy Mode = "fuzzy"
	// ModeExact matches the text as typed, line by line
	ModeExact Mode = "exact"
)

const (
	// MaxPattern caps the text of an exact or regex query
	MaxPattern = 1 << 10
	// maxLinesPerResult is how many matching lines one note carries
	maxLinesPerResult = 20
	// maxMatchedLines stops a scan that matched this many lines in all
	maxMatchedLines = 5000
	// checkEvery is how many lines a scan reads between two looks at its
	// deadline
	checkEvery = 1000

	// a typo is allowed in a word this long and longer, and a short word
	// matches too much at one edit to mean anything
	minTypoRunes = 4
	// a typo must not pull half the vocabulary into one query
	maxTypoTerms = 50

	// a long line is cut to a window this wide around its first match, with
	// this much of it before the match
	lineWindowRunes = 200
	lineLeadRunes   = 60
)

// ErrPattern is a query the scan cannot run: too long, or a regular
// expression RE2 does not accept.
var ErrPattern = errors.New("bad pattern")

// Query is one search of the space.
type Query struct {
	Text string
	Mode Mode
	// Case, Word and Regex are the toggles of Exact; Regex turns Fuzzy off
	Case, Word, Regex bool
	// TitlesOnly matches the title of a note and nothing else
	TitlesOnly bool
}

// Span is a piece of a line or a title, and Hit says whether it matched.
type Span struct {
	Text string
	Hit  bool
}

// Line is one line of a note that matched, by its line in the source.
type Line struct {
	Line  int
	Spans []Span
}

// FindQuery is what opens a note with its find bar filled in so that it
// finds what the search found.
type FindQuery struct {
	Text              string
	Case, Word, Regex bool
}

// Result is one note that matched.
type Result struct {
	Path       string
	Title      string
	TitleSpans []Span
	Score      float64
	MatchCount int
	LineCount  int
	Lines      []Line
	// Snippet is escaped HTML with the matches marked, the way a Hit has it
	Snippet template.HTML
	Find    FindQuery
}

// Found is what a search returned. Truncated says it stopped early, at its
// deadline or at maxMatchedLines.
type Found struct {
	Results   []Result
	Truncated bool
}

// Find runs a query over the space and returns at most limit notes, best
// first. A context that ends stops an exact or regex scan where it is.
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

// compileQuery is the one regular expression an exact or regex query runs
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

// fuzzy is the ranked word search, with a word that matches nothing as typed
// widened to the words one typo away
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

	top := ix.top(parsed, slots, limit)
	res := Found{Results: make([]Result, 0, len(top))}
	for _, cand := range top {
		res.Results = append(res.Results, cand.doc.fuzzyResult(parsed.terms, cand, q.TitlesOnly))
	}
	return res
}

// typoSlot widens a term that matched nothing to the indexed terms one edit
// away from it, and marks the term as one that matches whole words
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

// inTitles keeps the documents where the term is in the title
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

// oneEdit reports whether b is a away by exactly one insertion, deletion or
// substitution of a rune
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
		return res
	}
	res.MatchCount = len(marks)
	res.Lines, res.LineCount = d.linesOf(marks)
	return res
}

// matchedWords is the escaped alternation of the whole words the postings
// matched, read from the text at their offsets: a prefix or a typo found a
// word the query did not spell, and the find in the note has to find it too
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

// findWordAt is the word around at as the find bar of a note bounds a whole
// word: _ joins it, where the index splits "foo_bar" into two words
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

// titleSpans marks the words of a title a fuzzy query matched
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

// spansOf cuts text into the pieces between and inside the marks
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

// lineOf is the index in d.lines of the line an offset of the text is on
func (d *document) lineOf(off int32) int {
	i, ok := slices.BinarySearchFunc(d.lines, off, func(m lineMark, off int32) int {
		return cmp.Compare(m.off, off)
	})
	if !ok {
		i--
	}
	return max(i, 0)
}

// lineBounds is where line i of d.lines starts and ends in the text
func (d *document) lineBounds(i int) (int, int) {
	start := int(d.lines[i].off)
	end := strings.IndexByte(d.plain[start:], '\n')
	if end < 0 {
		return start, len(d.plain)
	}
	return start, start + end
}

// linesOf groups the marks by the line they are on, carrying the first
// maxLinesPerResult of them, and counts the lines
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

// shift moves marks onto a line that starts at start, and with -start back off
// it onto the whole text
func shift(marks []mark, start int) []mark {
	res := make([]mark, 0, len(marks))
	for _, m := range marks {
		res = append(res, mark{start: m.start - off32(start), end: m.end - off32(start), term: m.term})
	}
	return res
}

// cutLine is a line as spans, a long one cut to a window around its first
// match, with an ellipsis where text was left out
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

// scan runs an exact or regex query over the text of every note, line by
// line, under the context's deadline
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

// scanLines fills the lines of a note that match and reports whether the scan
// has to stop, at the deadline or at the cap on matched lines
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

// firstSnippet is the window around the first line that matches, or the lead
// of a note where none does before the deadline
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

// patternMarks are the matches of re in text, the empty ones left out: ^, $
// and a* match nothing a reader can see, and the find in the note skips them
// the same way. Whole word keeps a match with no letter, digit or _ on either
// side, which RE2's \b cannot say outside ASCII.
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
