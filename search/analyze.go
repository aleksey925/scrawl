package search

import (
	"strings"
)

type field uint8

const (
	fieldTitle field = iota
	fieldHeading
	fieldBody
	fieldCode
	numFields
)

var fieldWeight = [numFields]float64{
	fieldTitle:   16,
	fieldHeading: 5,
	fieldBody:    1,
	fieldCode:    0.4,
}

const maxDocBytes = 256 << 10

func off32(n int) int32 {
	return int32(n) //nolint:gosec // bounded by maxDocBytes
}

type span struct {
	start, end int32
}

type lineMark struct {
	off  int32
	line int32
}

type fieldToken struct {
	term  string
	field field
	off   int32
}

type analyzed struct {
	title  string
	plain  string
	code   []span
	lines  []lineMark
	tokens []fieldToken
}

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

type link struct {
	closeAt, resumeAt int
}

func cleanInline(s string) string {
	var b strings.Builder
	b.Grow(len(s))

	open := []link{}
	for i := 0; i < len(s); {
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

func stripQuote(line string) string {
	s := strings.TrimLeft(line, " \t")
	for strings.HasPrefix(s, ">") {
		s = strings.TrimLeft(s[1:], " \t")
	}
	return s
}

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
