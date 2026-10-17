package render

import "strings"

// document is a preprocessed source together with the number of lines of the
// original file dropped in front of it, which is the frontmatter.
type document struct {
	src     []byte
	dropped int
}

// preprocess strips a leading YAML frontmatter block and maps fence languages
// onto chroma lexer names. Every other line passes through as written, so a
// line of the result is the line of the file that sits dropped lines below it.
func preprocess(src []byte) document {
	lines, dropped := dropFrontmatter(strings.Split(string(src), "\n"))
	var fence fenceScanner
	for i, line := range lines {
		if fence.step(line) && fence.opened {
			lines[i] = normalizeFenceInfo(line, fence.length)
		}
	}
	return document{src: []byte(strings.Join(lines, "\n")), dropped: dropped}
}

// Frontmatter returns the leading YAML block Render leaves off the page, its
// delimiters included, or "" when the document has none.
func Frontmatter(src []byte) string {
	lines := strings.Split(string(src), "\n")
	_, dropped := dropFrontmatter(lines)
	return strings.Join(lines[:dropped], "\n")
}

// dropFrontmatter removes a leading YAML block delimited by "---". TOML "+++"
// blocks are not supported: "---" is the only delimiter that markdown itself
// would otherwise misread.
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

// fenceScanner tracks fenced code blocks, so a line of code that looks like a
// fence is never taken for one. Indentation is ignored: a fence in a list item
// is indented.
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
