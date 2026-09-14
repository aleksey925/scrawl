package render

import (
	"bytes"
	"unicode"
	"unicode/utf8"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// GitHub reads TeX out of four places: a "```math" fence, a "$$" block on its
// own lines, "$...$" inline and "$`...`$" inline. Only the last three live
// here; the fence is handled with mermaid in fence.go.
//
// The delimiter rules are what keeps a shell snippet written in prose from
// turning into a formula, which matters because the corpus is full of "$HOME"
// and "$1". Checked against api.github.com/markdown in "gfm" mode, an inline
// expression needs all of:
//
//   - the opening "$" is not preceded by a letter or a digit, so "1$x$" is
//     text;
//   - the opening "$" is not followed by whitespace, so "$ x$" is text;
//   - the closing "$" is not followed by a letter or a digit, which is what
//     makes "costs $100 and $200 total" and "$100$200" stay text;
//   - the content is not empty and does not cross a line break.
//
// Whitespace in front of the closing "$" is allowed, unlike in Pandoc.
// GitHub tests the neighbors for an ASCII alphanumeric; this uses the Unicode
// classes instead, because the corpus is Russian and "$5$рублей" reads as
// prose there for exactly the same reason "$5$x" does in English.
//
// One deliberate difference: GitHub looks for math in the rendered HTML, so
// "$a*b*c$" is not an expression there, the emphasis having already split the
// text. Here the source is read directly and the author gets the expression
// they wrote.
var dollarDollar = []byte("$$")

const (
	openInlineMath  = `<span class="math math-inline">`
	closeInlineMath = "</span>"
	// openDisplayMathInline is a "$$...$$" pair found inside a paragraph. It
	// carries the same class as the block form, so the frontend treats it the
	// same way, but it is a span: a div inside a paragraph is not valid HTML.
	openDisplayMathInline = `<span class="math math-display">`
)

var kindMathInline = ast.NewNodeKind("MathInline")

type mathInline struct {
	ast.BaseInline
	display bool
	segment text.Segment
}

func (n *mathInline) Kind() ast.NodeKind { return kindMathInline }

func (n *mathInline) IsRaw() bool { return true }

func (n *mathInline) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, map[string]string{"Value": string(n.segment.Value(source))}, nil)
}

// mathBlockParser reads a "$$" block. It cannot interrupt a paragraph, so a
// stray "$$" in running text stays text.
type mathBlockParser struct{}

func (p *mathBlockParser) Trigger() []byte { return []byte{'$'} }

func (p *mathBlockParser) Open(_ ast.Node, reader text.Reader, pc parser.Context) (ast.Node, parser.State) {
	line, segment := reader.PeekLine()
	pos := pc.BlockOffset()
	if pos < 0 || !bytes.HasPrefix(line[pos:], dollarDollar) {
		return nil, parser.NoChildren
	}
	rest := bytes.TrimRight(line[pos+2:], " \t\r\n")
	at := segment.Start + pos
	node := &rawBlock{open: openDisplayMath, close: closeDisplayMath, span: srcSpan{start: at, end: at}}
	switch {
	case len(rest) >= 2 && bytes.HasSuffix(rest, dollarDollar):
		node.closed = true
		if start := segment.Start + pos + 2; len(rest) > 2 {
			node.Lines().Append(text.NewSegment(start, start+len(rest)-2))
		}
	case len(rest) != 0:
		return nil, parser.NoChildren
	}
	reader.Advance(segment.Stop - segment.Start - pos - 1)
	return node, parser.NoChildren
}

func (p *mathBlockParser) Continue(node ast.Node, reader text.Reader, _ parser.Context) parser.State {
	block := node.(*rawBlock)
	if block.closed {
		return parser.Close
	}
	line, segment := reader.PeekLine()
	block.span.end = segment.Start
	if bytes.Equal(bytes.TrimSpace(line), dollarDollar) {
		block.closed = true
		reader.Advance(segment.Stop - segment.Start - 1)
		return parser.Close
	}
	node.Lines().Append(segment)
	return parser.Continue | parser.NoChildren
}

func (p *mathBlockParser) Close(_ ast.Node, _ text.Reader, _ parser.Context) {}

func (p *mathBlockParser) CanInterruptParagraph() bool { return false }

func (p *mathBlockParser) CanAcceptIndentedLine() bool { return false }

type mathInlineParser struct{}

func (p *mathInlineParser) Trigger() []byte { return []byte{'$'} }

func (p *mathInlineParser) Parse(_ ast.Node, block text.Reader, _ parser.Context) ast.Node {
	raw, segment := block.PeekLine()
	line := bytes.TrimRight(raw, "\r\n")
	if len(line) < 2 || isAlphanumeric(block.PrecendingCharacter()) {
		return nil
	}
	if line[1] == '`' {
		return parseDollarBacktick(block, line, segment)
	}

	display := line[1] == '$'
	delim := 1
	if display {
		delim = 2
	}
	body := line[delim:]
	end := closingDollar(body, delim)
	if end < 0 {
		return nil
	}
	content := body[:end]
	if len(content) == 0 || isMathSpace(content[0]) {
		return nil
	}
	after := delim + end + delim
	if r, _ := utf8.DecodeRune(line[min(after, len(line)):]); isAlphanumeric(r) {
		return nil
	}
	block.Advance(after)
	start := segment.Start + delim
	return &mathInline{display: display, segment: text.NewSegment(start, start+len(content))}
}

// parseDollarBacktick reads the "$`...`$" form, which GitHub offers so an
// expression can hold characters the plain form would choke on.
func parseDollarBacktick(block text.Reader, line []byte, segment text.Segment) ast.Node {
	ticks := 0
	for 1+ticks < len(line) && line[1+ticks] == '`' {
		ticks++
	}
	body := line[1+ticks:]
	end := bytes.Index(body, append(bytes.Repeat([]byte("`"), ticks), '$'))
	if end <= 0 {
		return nil
	}
	block.Advance(1 + ticks + end + ticks + 1)
	start := segment.Start + 1 + ticks
	return &mathInline{segment: text.NewSegment(start, start+end)}
}

// closingDollar returns the offset of the first run of at least n unescaped
// dollars, or -1 when the line holds none.
func closingDollar(body []byte, n int) int {
	for i := 0; i < len(body); i++ {
		if body[i] != '$' || isEscaped(body, i) {
			continue
		}
		run := 1
		for i+run < len(body) && body[i+run] == '$' {
			run++
		}
		if run >= n {
			return i
		}
		i += run - 1
	}
	return -1
}

func isEscaped(body []byte, i int) bool {
	slashes := 0
	for j := i - 1; j >= 0 && body[j] == '\\'; j-- {
		slashes++
	}
	return slashes%2 == 1
}

func isMathSpace(c byte) bool { return c == ' ' || c == '\t' }

func isAlphanumeric(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }

type mathRenderer struct{}

func (r *mathRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(kindMathInline, r.render)
}

func (r *mathRenderer) render(
	w util.BufWriter, source []byte, node ast.Node, entering bool,
) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	n := node.(*mathInline)
	open := openInlineMath
	if n.display {
		open = openDisplayMathInline
	}
	_, _ = w.WriteString(open)
	html.DefaultWriter.RawWrite(w, n.segment.Value(source))
	_, _ = w.WriteString(closeInlineMath)
	return ast.WalkContinue, nil
}
