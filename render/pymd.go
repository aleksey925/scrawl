package render

import (
	"regexp"
	"strconv"
	"strings"
)

// The notes were authored against Python-Markdown 3.8 with
// pymdownx.superfences, md_in_html, a custom "breakless_lists" preprocessor
// and mdx_linkify. Everything except the three constructs below is either
// plain CommonMark or covered by a goldmark extension, so this layer stays
// small on purpose: it rewrites the source at render time only, never the
// file on disk.
//
// Deliberately not ported:
//   - md_in_html on arbitrary block tags (`<div markdown="1">`): the corpus
//     only ever uses it on <details>, and a general implementation means
//     re-parsing HTML blocks by hand.
//   - breakless_lists for bullet lists: CommonMark already lets a bullet
//     list interrupt a paragraph, so the 80 corpus cases render as intended.
//   - the smart handling of `<h3>` outside a list item: there it is a real
//     HTML block in both renderers, so there is nothing to fix.

var (
	// a list item whose whole content is one inline heading tag, as in
	// "1. <h3>[Принципы проектирования](#Принципы)</h3>". goldmark sees the
	// line as an HTML block and never parses the link inside it.
	reListItemHeading = regexp.MustCompile(
		`^(\s*(?:[-*+]|\d{1,9}[.)])\s+)<(h[1-6])>(.*)</(h[1-6])>[ \t]*\r?$`)

	// an ordered list item that does not start at 1. CommonMark refuses to
	// let it interrupt a paragraph, Python-Markdown starts the list anyway.
	reOrderedItem = regexp.MustCompile(`^ {0,3}(\d{1,9})[.)][ \t]`)

	reListItem = regexp.MustCompile(`^\s*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|\r?$)`)

	reDetailsOpen  = regexp.MustCompile(`^[ \t]*<details\b[^>]*>[ \t]*\r?$`)
	reSummaryEnd   = regexp.MustCompile(`</summary>[ \t]*\r?$`)
	reDetailsClose = regexp.MustCompile(`^[ \t]*</details>[ \t]*\r?$`)
)

// document is a preprocessed source together with, for every one of its lines,
// the 1-based line of the original file that line came from.
type document struct {
	src    []byte
	origin []int
}

// preprocess applies the Python-Markdown compatibility layer and strips a
// leading YAML frontmatter block. Fenced code is passed through untouched.
func preprocess(src []byte) document {
	lines, dropped := dropFrontmatter(strings.Split(string(src), "\n"))
	out := newLineBuffer(len(lines) + 8)

	var fence fenceScanner
	inList := false
	for i, line := range lines {
		num := dropped + i + 1
		if fence.step(line) {
			if fence.opened {
				line = normalizeFenceInfo(line, fence.length)
			}
			out.add(line, num)
			continue
		}
		prev := out.last()
		if !inList && interruptingOrderedItem(line) && isParagraphText(prev) {
			out.add("", num)
		}
		inList = stillInList(inList, line, prev)
		out.add(unwrapListItemHeading(line), num)

		if needsBlankAfter(line, lineAt(lines, i+1)) {
			out.add("", num)
		}
		if reDetailsClose.MatchString(line) {
			out.insertBlankBeforeLast()
		}
	}
	return document{src: []byte(strings.Join(out.lines, "\n")), origin: out.origin}
}

// lineBuffer collects the preprocessed lines and keeps every one of them paired
// with the original line it came from.
type lineBuffer struct {
	lines  []string
	origin []int
}

func newLineBuffer(size int) lineBuffer {
	return lineBuffer{lines: make([]string, 0, size), origin: make([]int, 0, size)}
}

func (b *lineBuffer) add(line string, src int) {
	b.lines = append(b.lines, line)
	b.origin = append(b.origin, src)
}

func (b *lineBuffer) last() string {
	if len(b.lines) == 0 {
		return ""
	}
	return b.lines[len(b.lines)-1]
}

// insertBlankBeforeLast puts a blank line in front of the line just added,
// unless one is already there.
func (b *lineBuffer) insertBlankBeforeLast() {
	n := len(b.lines)
	if n < 2 || blank(b.lines[n-2]) {
		return
	}
	line, src := b.lines[n-1], b.origin[n-1]
	b.lines[n-1] = ""
	b.add(line, src)
}

// stillInList tracks whether the current line sits inside a list, because an
// ordered item that continues an open list is legal CommonMark and must not
// get a blank line in front of it.
func stillInList(inList bool, line, prev string) bool {
	switch {
	case isListStart(line):
		return true
	case !blank(line) && indentOf(line) == 0 && blank(prev):
		return false
	}
	return inList
}

// unwrapListItemHeading replaces a block-level heading tag that is the whole
// content of a list item with an inline one. goldmark reads "1. <h3>..." as an
// HTML block and leaves the markdown link inside it literal; <strong> keeps
// the visual weight and lets the link render.
func unwrapListItemHeading(line string) string {
	m := reListItemHeading.FindStringSubmatch(line)
	if len(m) != 5 || m[2] != m[4] {
		return line
	}
	return m[1] + `<strong class="md-` + m[2] + `">` + m[3] + `</strong>`
}

// needsBlankAfter reports whether a blank line has to follow to end the raw
// HTML block, so that the markdown inside <details> is parsed instead of
// being emitted literally. Python-Markdown does this through
// markdown="span"; goldmark only obeys the CommonMark blank-line rule.
func needsBlankAfter(line, next string) bool {
	if blank(next) {
		return false
	}
	if reSummaryEnd.MatchString(line) {
		return true
	}
	return reDetailsOpen.MatchString(line) && !strings.HasPrefix(strings.TrimSpace(next), "<summary")
}

func lineAt(lines []string, i int) string {
	if i < 0 || i >= len(lines) {
		return ""
	}
	return lines[i]
}

func blank(line string) bool { return strings.TrimSpace(line) == "" }

func isListStart(line string) bool { return reListItem.MatchString(line) }

func indentOf(line string) int {
	return len(line) - len(strings.TrimLeft(line, " \t"))
}

// isParagraphText reports whether the line is ordinary paragraph text, the
// only context where an ordered list fails to start.
func isParagraphText(line string) bool {
	if blank(line) || indentOf(line) > 3 || isListStart(line) {
		return false
	}
	switch strings.TrimSpace(line)[0] {
	case '#', '>', '<', '|', '=', '-', '`', '~':
		return false
	}
	return true
}

func interruptingOrderedItem(line string) bool {
	m := reOrderedItem.FindStringSubmatch(line)
	if m == nil {
		return false
	}
	n, err := strconv.Atoi(m[1])
	return err == nil && n != 1
}

// dropFrontmatter removes a leading YAML block delimited by "---". TOML "+++"
// blocks are not supported: the corpus has no frontmatter at all, and "---" is
// the only delimiter that markdown itself would otherwise misread.
func dropFrontmatter(lines []string) (body []string, dropped int) {
	if len(lines) == 0 || strings.TrimRight(lines[0], " \t\r") != "---" {
		return lines, 0
	}
	for i := 1; i < len(lines); i++ {
		switch strings.TrimRight(lines[i], " \t\r") {
		case "---", "...":
			return lines[i+1:], i + 1
		}
	}
	return lines, 0
}

// normalizeFenceInfo maps the fence language onto a chroma lexer name. The
// lookup happens inside the highlighting extension, which reads the info
// string straight from the source, so the rename has to happen here.
func normalizeFenceInfo(line string, markerLen int) string {
	at := strings.IndexAny(line, "`~")
	if at < 0 {
		return line
	}
	head, info := line[:at+markerLen], strings.TrimRight(line[at+markerLen:], " \t\r")
	lang, rest, _ := strings.Cut(strings.TrimLeft(info, " \t"), " ")
	alias, ok := languageAliases[strings.ToLower(lang)]
	if !ok {
		return line
	}
	if rest != "" {
		alias += " " + rest
	}
	return head + alias
}

// fenceScanner tracks fenced code blocks so the rewrites above never touch
// code. Indentation is ignored: 84 corpus fences sit inside list items.
type fenceScanner struct {
	open   bool
	opened bool
	marker byte
	length int
}

// step reports whether the line is part of a fenced block, opener and closer
// included.
func (f *fenceScanner) step(line string) bool {
	f.opened = false
	t := strings.TrimLeft(line, " \t")
	if f.open {
		n := fenceRun(t, f.marker)
		if n >= f.length && strings.TrimRight(t, " \t\r") == strings.Repeat(string(f.marker), n) {
			f.open = false
		}
		return true
	}
	for _, marker := range []byte{'`', '~'} {
		n := fenceRun(t, marker)
		if n < 3 {
			continue
		}
		// a backtick fence may not carry a backtick in its info string
		if marker == '`' && strings.Contains(t[n:], "`") {
			continue
		}
		f.open, f.opened, f.marker, f.length = true, true, marker, n
		return true
	}
	return false
}

func fenceRun(s string, marker byte) int {
	n := 0
	for n < len(s) && s[n] == marker {
		n++
	}
	return n
}
