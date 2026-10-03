package search

import (
	"strings"
)

// field is the part of a document a term was found in. Ranking is entirely
// driven by which field a term landed in, see fieldWeight.
type field uint8

const (
	fieldTitle field = iota
	fieldHeading
	fieldBody
	fieldCode
	numFields
)

// fieldWeight sets the ranking order. Every weight is more than bm25K1+1 times
// the next one, and the per-field score saturates at weight*(bm25K1+1), so one
// title hit always outranks any number of heading hits, a heading hit always
// outranks body hits, and code can never outrank prose.
var fieldWeight = [numFields]float64{
	fieldTitle:   16,
	fieldHeading: 5,
	fieldBody:    1,
	fieldCode:    0.4,
}

// maxDocBytes caps how much of one document is indexed. Nothing useful is
// found by full-text search past a quarter of a megabyte, and the cap bounds
// what a single pathological file can cost.
const maxDocBytes = 256 << 10

// off32 narrows an offset into a document. Every offset the analyzer produces
// is bounded by maxDocBytes, so the conversion cannot overflow.
func off32(n int) int32 {
	return int32(n) //nolint:gosec // bounded by maxDocBytes
}

// span is a byte range of the extracted plain text.
type span struct {
	start, end int32
}

// lineMark ties a byte offset of the plain text back to the line it came from
// in the markdown source.
type lineMark struct {
	off  int32
	line int32
}

// fieldToken is a term ready to be indexed. off is -1 for terms that only
// carry weight and have no place in the plain text, such as a title taken from
// the file name.
type fieldToken struct {
	term  string
	field field
	off   int32
}

// analyzed is the indexable view of one markdown document: the markup is gone,
// but every offset still points into the text a snippet is built from.
type analyzed struct {
	title  string
	plain  string
	code   []span
	lines  []lineMark
	tokens []fieldToken
}

// fence describes a code fence line.
type fence struct {
	char byte
	n    int
	info bool
}

type analyzer struct {
	out       strings.Builder
	res       analyzed
	open      fence
	inCode    bool
	codeStart int32
	lastField field
	lastLine  int32
}

// analyze strips markdown noise from content and collects the terms to index.
// Code fences stay searchable but are marked, so a snippet prefers prose.
func analyze(docPath string, content []byte) analyzed {
	a := &analyzer{codeStart: -1}
	lines := strings.Split(cutBytes(normalize(string(content)), maxDocBytes), "\n")
	for n := 0; n < len(lines); {
		n += a.step(lines, n)
	}
	a.closeCode()
	a.finish(docPath)
	return a.res
}

// step handles one source line and returns how many lines it consumed.
func (a *analyzer) step(lines []string, n int) int {
	line := strings.TrimSuffix(lines[n], "\r")

	if f, ok := fenceInfo(line); ok && a.toggleFence(f) {
		return 1
	}
	if a.inCode {
		a.emit(line, fieldCode, n+1)
		return 1
	}
	if n+1 < len(lines) && a.setext(line, lines[n+1], n+1) {
		return 2
	}
	a.prose(line, n+1)
	return 1
}

// toggleFence opens or closes a code block and reports whether the line was a
// fence marker rather than code content.
func (a *analyzer) toggleFence(f fence) bool {
	if !a.inCode {
		a.inCode, a.open, a.codeStart = true, f, -1
		return true
	}
	if f.char != a.open.char || f.n < a.open.n || f.info {
		return false
	}
	a.closeCode()
	return true
}

func (a *analyzer) closeCode() {
	if a.codeStart >= 0 {
		a.res.code = append(a.res.code, span{start: a.codeStart, end: off32(a.out.Len())})
	}
	a.inCode, a.codeStart = false, -1
}

// setext handles a heading underlined with = or -, the form 25 of the 27
// corpus files use for their title. The underline is only a heading when the
// line above it is a paragraph, otherwise --- is a thematic break.
func (a *analyzer) setext(line, next string, n int) bool {
	level := setextLevel(next)
	if level == 0 {
		return false
	}
	text := stripQuote(line)
	if isBlank(text) || isThematicBreak(text) || isListItem(text) || atxLevel(text) > 0 {
		return false
	}
	a.heading(text, level, n)
	return true
}

func (a *analyzer) prose(line string, n int) {
	text := stripQuote(line)
	if isBlank(text) || isThematicBreak(text) || isTableRule(text) {
		return
	}
	if level := atxLevel(text); level > 0 {
		a.heading(strings.TrimLeft(text, "# \t"), level, n)
		return
	}
	a.emit(cleanInline(stripListMarker(text)), fieldBody, n)
}

func (a *analyzer) heading(text string, level, n int) {
	clean := cleanInline(strings.TrimRight(strings.TrimSpace(text), "# \t"))
	a.emit(clean, fieldHeading, n)
	if level == 1 && a.res.title == "" {
		a.res.title = strings.TrimSpace(clean)
	}
}

// emit appends one cleaned line to the plain text and records its terms. A
// block boundary gets a blank line, so a phrase search can tell a hard wrap
// inside a paragraph from the end of a heading.
func (a *analyzer) emit(text string, f field, n int) {
	text = strings.TrimRight(text, " \t")
	if isBlank(text) {
		return
	}

	if a.out.Len() > 0 && (f != a.lastField || off32(n) != a.lastLine+1) {
		a.out.WriteByte('\n')
	}
	a.lastField, a.lastLine = f, off32(n)

	base := off32(a.out.Len())
	if f == fieldCode && a.codeStart < 0 {
		a.codeStart = base
	}
	a.res.lines = append(a.res.lines, lineMark{off: base, line: off32(n)})
	for _, t := range tokenize(text) {
		a.res.tokens = append(a.res.tokens, fieldToken{term: t.term, field: f, off: base + off32(t.off)})
	}
	a.out.WriteString(text)
	a.out.WriteByte('\n')
}

// finish materializes the plain text and indexes the title, which outweighs
// every other field and therefore gets its own terms.
func (a *analyzer) finish(docPath string) {
	a.res.plain = a.out.String()
	if a.res.title == "" {
		a.res.title = titleFromPath(docPath)
	}
	for _, t := range tokenize(normalize(a.res.title)) {
		a.res.tokens = append(a.res.tokens, fieldToken{term: t.term, field: fieldTitle, off: -1})
	}
}

func titleFromPath(docPath string) string {
	base := docPath
	if i := strings.LastIndexByte(base, '/'); i >= 0 {
		base = base[i+1:]
	}
	if i := strings.LastIndexByte(base, '.'); i > 0 {
		base = base[:i]
	}
	return base
}

func isBlank(s string) bool {
	return strings.TrimSpace(s) == ""
}

// link remembers where the text of a link ends and where the scanner has to
// resume to skip the destination.
type link struct {
	closeAt, resumeAt int
}

// cleanInline drops inline markup from one line: HTML tags, link and image
// destinations, code and emphasis markers. The text inside a link or an image
// survives, the URL does not.
func cleanInline(s string) string {
	var b strings.Builder
	b.Grow(len(s))

	open := []link{}
	for i := 0; i < len(s); {
		// a skipped tag can jump over a label end, so pop on >= and never let
		// the resume point move the scanner backwards into an endless loop
		if n := len(open) - 1; n >= 0 && i >= open[n].closeAt {
			i = max(i, open[n].resumeAt)
			open = open[:n]
			continue
		}

		switch c := s[i]; {
		case c == '\\' && i+1 < len(s) && isPunct(s[i+1]):
			b.WriteByte(s[i+1])
			i += 2
		case c == '<':
			i = skipTag(&b, s, i)
		case c == '!' && i+1 < len(s) && s[i+1] == '[':
			i++
		case c == '[':
			i = openLink(&b, s, i, &open)
		case c == '`' || c == '*' || c == '~':
			i++
		default:
			b.WriteByte(c)
			i++
		}
	}
	return b.String()
}

// skipTag drops an HTML tag or an autolink, and keeps a lone < as text.
func skipTag(b *strings.Builder, s string, i int) int {
	rest := s[i+1:]
	if rest == "" || (!isASCIILetter(rest[0]) && rest[0] != '/' && rest[0] != '!') {
		b.WriteByte(s[i])
		return i + 1
	}
	end := strings.IndexByte(rest, '>')
	if end < 0 {
		b.WriteByte(s[i])
		return i + 1
	}
	return i + 1 + end + 1
}

// openLink records where the label of a link ends so the destination can be
// skipped, and keeps a lone [ as text.
func openLink(b *strings.Builder, s string, i int, open *[]link) int {
	label := matchBracket(s, i, '[', ']')
	if label < 0 {
		b.WriteByte(s[i])
		return i + 1
	}

	resume := label + 1
	switch {
	case resume < len(s) && s[resume] == '(':
		if end := matchBracket(s, resume, '(', ')'); end > 0 {
			resume = end + 1
		}
	case resume < len(s) && s[resume] == '[':
		if end := matchBracket(s, resume, '[', ']'); end > 0 {
			resume = end + 1
		}
	}
	*open = append(*open, link{closeAt: label, resumeAt: resume})
	return i + 1
}

// matchBracket returns the offset of the bracket closing the one at i, or -1.
func matchBracket(s string, i int, open, closing byte) int {
	depth := 0
	for j := i; j < len(s); j++ {
		switch s[j] {
		case open:
			depth++
		case closing:
			depth--
			if depth == 0 {
				return j
			}
		}
	}
	return -1
}

func isASCIILetter(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z'
}

func isPunct(c byte) bool {
	return c < 0x80 && !isASCIILetter(c) && (c < '0' || c > '9') && c > ' '
}

// fenceInfo reports whether the line opens or closes a fenced code block.
func fenceInfo(line string) (fence, bool) {
	s := strings.TrimLeft(line, " \t")
	if s == "" || (s[0] != '`' && s[0] != '~') {
		return fence{}, false
	}
	c := s[0]
	n := 0
	for n < len(s) && s[n] == c {
		n++
	}
	if n < 3 {
		return fence{}, false
	}
	rest := strings.TrimSpace(s[n:])
	if c == '`' && strings.ContainsRune(rest, '`') {
		return fence{}, false
	}
	return fence{char: c, n: n, info: rest != ""}, true
}

// atxLevel returns the level of a "### heading" line, or 0.
func atxLevel(line string) int {
	s := strings.TrimLeft(line, " \t")
	n := 0
	for n < len(s) && s[n] == '#' {
		n++
	}
	if n == 0 || n > 6 {
		return 0
	}
	if n < len(s) && s[n] != ' ' && s[n] != '\t' {
		return 0
	}
	return n
}

// setextLevel returns 1 for an "===" underline, 2 for "---", or 0.
func setextLevel(line string) int {
	s := strings.TrimSpace(line)
	if s == "" {
		return 0
	}
	switch {
	case strings.Trim(s, "=") == "":
		return 1
	case strings.Trim(s, "-") == "":
		return 2
	}
	return 0
}

func isThematicBreak(line string) bool {
	s := strings.Join(strings.Fields(line), "")
	if len(s) < 3 {
		return false
	}
	return strings.Trim(s, "-") == "" || strings.Trim(s, "*") == "" || strings.Trim(s, "_") == ""
}

// isTableRule matches the |---|:--:| row that separates a table header from
// its body and carries no text.
func isTableRule(line string) bool {
	s := strings.TrimSpace(line)
	if !strings.ContainsRune(s, '|') || !strings.ContainsRune(s, '-') {
		return false
	}
	return strings.Trim(s, "|-: \t") == ""
}

func isListItem(line string) bool {
	return stripListMarker(line) != strings.TrimLeft(line, " \t")
}

// stripQuote removes the leading blockquote markers of a line.
func stripQuote(line string) string {
	s := strings.TrimLeft(line, " \t")
	for strings.HasPrefix(s, ">") {
		s = strings.TrimLeft(s[1:], " \t")
	}
	return s
}

// stripListMarker removes a leading bullet or ordered list marker.
func stripListMarker(line string) string {
	s := strings.TrimLeft(line, " \t")
	if rest, ok := stripBullet(s); ok {
		return rest
	}
	if rest, ok := stripOrdered(s); ok {
		return rest
	}
	return s
}

func stripBullet(s string) (string, bool) {
	if len(s) > 1 && (s[0] == '-' || s[0] == '*' || s[0] == '+') && isSpaceByte(s[1]) {
		return strings.TrimLeft(s[2:], " \t"), true
	}
	return "", false
}

func stripOrdered(s string) (string, bool) {
	digits := 0
	for digits < len(s) && digits < 9 && s[digits] >= '0' && s[digits] <= '9' {
		digits++
	}
	if digits == 0 || digits+1 >= len(s) {
		return "", false
	}
	if (s[digits] == '.' || s[digits] == ')') && isSpaceByte(s[digits+1]) {
		return strings.TrimLeft(s[digits+2:], " \t"), true
	}
	return "", false
}

func isSpaceByte(c byte) bool {
	return c == ' ' || c == '\t'
}
