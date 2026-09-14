package render

import (
	"bytes"
	"regexp"
	"sort"
	"strconv"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// A rendered block carries the span of original lines it was written on, so the
// editor can open where the reader was and the preview can be scrolled against
// the source. Both bounds are 1-based and inclusive, and they are line numbers
// rather than byte offsets: goldmark counts bytes, CodeMirror counts UTF-16
// code units, and the corpus is Cyrillic, so an offset that reached the client
// would be wrong on nearly every document.
const (
	srcStartAttr = "data-source-start"
	srcEndAttr   = "data-source-end"
)

var srcRangeAttrs = [...]string{srcStartAttr, srcEndAttr}

// srcLinesKey carries the line index of the document being rendered. Like the
// document directory it is per-request state, so it lives in the parser.Context
// and never on the shared Renderer.
var srcLinesKey = parser.NewContextKey()

var (
	reDetailsTag = regexp.MustCompile(`^[ \t]*<details\b`)
	// the line a horizontal rule is written on. goldmark's thematic break node
	// carries neither lines nor children, so the rule has to be found by hand.
	reThematicBreak = regexp.MustCompile(
		`^ {0,3}(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})\r?$`)
)

// srcSpan is a block's position in the preprocessed source, as the byte offsets
// of its first and last line.
type srcSpan struct {
	start int
	end   int
}

// srcLines maps a byte offset of the preprocessed source onto the line of the
// original file it came from. preprocess drops frontmatter, inserts blank lines
// and rewrites single lines, so the two numberings do not share an offset.
type srcLines struct {
	starts []int // offset every preprocessed line begins at
	origin []int // original 1-based line every preprocessed line came from
}

func newSrcLines(doc document) srcLines {
	starts := make([]int, 1, len(doc.origin)+1)
	for i, c := range doc.src {
		if c == '\n' {
			starts = append(starts, i+1)
		}
	}
	return srcLines{starts: starts, origin: doc.origin}
}

// at is the original line the offset falls on. An offset past the end of the
// document answers with its last line.
func (s srcLines) at(offset int) int {
	i := sort.SearchInts(s.starts, offset+1) - 1
	if i < 0 || i >= len(s.origin) {
		return 0
	}
	return s.origin[i]
}

// srcLineTransformer annotates every block that reaches the reader as its own
// element. It runs last, so the alert, raw fence and table wrap nodes are
// already in place and get annotated instead of the nodes they replaced.
type srcLineTransformer struct{}

func (t *srcLineTransformer) Transform(doc *ast.Document, reader text.Reader, pc parser.Context) {
	lines, ok := pc.Get(srcLinesKey).(srcLines)
	if !ok {
		return
	}
	source := reader.Source()
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		if n.Type() == ast.TypeInline {
			return ast.WalkSkipChildren, nil
		}
		if carriesSrcRange(n, source) {
			annotate(n, source, lines)
		}
		return ast.WalkContinue, nil
	})
}

func annotate(n ast.Node, source []byte, lines srcLines) {
	start, ok := blockStart(n, source)
	if !ok {
		return
	}
	end, ok := blockEnd(n, source)
	if !ok {
		return
	}
	first, last := lines.at(start), lines.at(end)
	if first == 0 || last < first {
		return
	}
	n.SetAttributeString(srcStartAttr, []byte(strconv.Itoa(first)))
	n.SetAttributeString(srcEndAttr, []byte(strconv.Itoa(last)))
}

// carriesSrcRange reports whether a node becomes an element the reader can land
// on. Nesting is annotated too: a long list or code block would be a single
// useless anchor if only its top level were.
func carriesSrcRange(n ast.Node, source []byte) bool {
	switch n.Kind() {
	case ast.KindHeading, ast.KindParagraph, ast.KindList, ast.KindListItem,
		ast.KindBlockquote, ast.KindCodeBlock, ast.KindFencedCodeBlock,
		ast.KindThematicBreak, kindAlert, kindRawBlock, kindTableWrap:
		return true
	case ast.KindHTMLBlock:
		lines := n.Lines()
		if lines.Len() == 0 {
			return false
		}
		first := lines.At(0)
		return reDetailsTag.Match(first.Value(source))
	}
	return false
}

// blockStart is the offset a block opens at. A node with no lines of its own,
// a list or a blockquote, opens where its first block child does.
func blockStart(n ast.Node, source []byte) (int, bool) {
	switch node := n.(type) {
	case *ast.FencedCodeBlock:
		return fenceStart(node, source)
	case *rawBlock:
		return node.span.start, true
	case *alert:
		return node.start, true
	case *ast.ThematicBreak:
		return thematicBreakStart(node, source)
	}
	if lines := n.Lines(); lines.Len() > 0 {
		return lines.At(0).Start, true
	}
	for child := n.FirstChild(); child != nil; child = child.NextSibling() {
		if child.Type() != ast.TypeBlock {
			continue
		}
		if offset, ok := blockStart(child, source); ok {
			return offset, true
		}
	}
	return 0, false
}

// blockEnd is the offset on the last line a block covers.
func blockEnd(n ast.Node, source []byte) (int, bool) {
	switch node := n.(type) {
	case *ast.FencedCodeBlock:
		return fenceEnd(node, source)
	case *rawBlock:
		return node.span.end, true
	case *ast.ThematicBreak:
		return thematicBreakStart(node, source)
	}
	if lines := n.Lines(); lines.Len() > 0 {
		last := lines.At(lines.Len() - 1)
		return max(last.Start, last.Stop-1), true
	}
	for child := n.LastChild(); child != nil; child = child.PreviousSibling() {
		if child.Type() != ast.TypeBlock {
			continue
		}
		if offset, ok := blockEnd(child, source); ok {
			return offset, true
		}
	}
	return 0, false
}

// fenceStart is the opening fence. goldmark's segments for a fenced block start
// below it, and the info string, when the block has one, sits on it.
func fenceStart(n *ast.FencedCodeBlock, source []byte) (int, bool) {
	if lines := n.Lines(); lines.Len() > 0 {
		return lineStartAbove(source, lines.At(0).Start), true
	}
	if n.Info != nil {
		return n.Info.Segment.Start, true
	}
	return 0, false
}

// fenceEnd is the closing fence, which goldmark leaves out of the segments the
// same way. A fence left open at the end of the file ends on its last line.
func fenceEnd(n *ast.FencedCodeBlock, source []byte) (int, bool) {
	lines := n.Lines()
	if lines.Len() == 0 {
		if n.Info != nil {
			return n.Info.Segment.Start, true
		}
		return 0, false
	}
	last := lines.At(lines.Len() - 1)
	if below := lineStartBelow(source, last.Start); isFenceLine(source, below) {
		return below, true
	}
	return max(last.Start, last.Stop-1), true
}

// thematicBreakStart is the marker line of a horizontal rule, searched for
// upwards from the block that follows it: only blank lines can sit between the
// two, so the first marker found going up is the rule. Searching down from the
// block before it would stop on the underline of a setext heading instead.
func thematicBreakStart(n ast.Node, source []byte) (int, bool) {
	below := len(source)
	if next := nextBlock(n); next != nil {
		start, ok := blockStart(next, source)
		if !ok {
			return 0, false
		}
		below = start
	}
	for at := lineStartAbove(source, below); ; at = lineStartAbove(source, at) {
		if isThematicBreakLine(source, at) {
			return at, true
		}
		if at == 0 {
			return 0, false
		}
	}
}

// nextBlock is the first block that starts after n, climbing out of the
// containers n closes.
func nextBlock(n ast.Node) ast.Node {
	for node := n; node != nil; node = node.Parent() {
		for next := node.NextSibling(); next != nil; next = next.NextSibling() {
			if next.Type() == ast.TypeBlock {
				return next
			}
		}
	}
	return nil
}

func isThematicBreakLine(source []byte, offset int) bool {
	return reThematicBreak.Match(lineAtOffset(source, offset))
}

// lineAtOffset is the line starting at offset, without its line break.
func lineAtOffset(source []byte, offset int) []byte {
	if offset >= len(source) {
		return nil
	}
	line := source[offset:]
	if at := bytes.IndexByte(line, '\n'); at >= 0 {
		line = line[:at]
	}
	return line
}

// lineStartAbove is where the line before the one holding offset begins.
func lineStartAbove(source []byte, offset int) int {
	start := bytes.LastIndexByte(source[:min(offset, len(source))], '\n') + 1
	if start == 0 {
		return 0
	}
	return bytes.LastIndexByte(source[:start-1], '\n') + 1
}

// lineStartBelow is where the line after the one holding offset begins, or the
// end of the source when there is no line below.
func lineStartBelow(source []byte, offset int) int {
	from := min(offset, len(source))
	at := bytes.IndexByte(source[from:], '\n')
	if at < 0 {
		return len(source)
	}
	return from + at + 1
}

// isFenceLine reports whether the line at offset is nothing but a fence marker.
func isFenceLine(source []byte, offset int) bool {
	line := bytes.TrimRight(bytes.TrimLeft(lineAtOffset(source, offset), " \t"), " \t\r")
	if len(line) < 3 || (line[0] != '`' && line[0] != '~') {
		return false
	}
	return len(bytes.Trim(line, string(line[0]))) == 0
}

// writeSrcRange appends the source range of a node to an open tag.
func writeSrcRange(w util.BufWriter, n ast.Node) {
	for _, name := range srcRangeAttrs {
		if value, ok := n.AttributeString(name); ok {
			writeSrcAttr(w, name, value)
		}
	}
}

// writeSrcAttr writes one bound. The value is generated digits, so nothing in
// it needs escaping.
func writeSrcAttr(w util.BufWriter, name string, value any) {
	digits, ok := value.([]byte)
	if !ok {
		return
	}
	_ = w.WriteByte(' ')
	_, _ = w.WriteString(name)
	_, _ = w.WriteString(`="`)
	_, _ = w.Write(digits)
	_ = w.WriteByte('"')
}

// blockquoteRenderer exists only to keep the output byte-identical: goldmark
// writes "<blockquote>\n" when the node carries no attributes and drops that
// newline as soon as it carries one.
type blockquoteRenderer struct{}

func (r *blockquoteRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(ast.KindBlockquote, r.render)
}

func (r *blockquoteRenderer) render(
	w util.BufWriter, _ []byte, node ast.Node, entering bool,
) (ast.WalkStatus, error) {
	if !entering {
		_, _ = w.WriteString("</blockquote>\n")
		return ast.WalkContinue, nil
	}
	_, _ = w.WriteString("<blockquote")
	writeSrcRange(w, node)
	_, _ = w.WriteString(">\n")
	return ast.WalkContinue, nil
}

// detailsRenderer is goldmark's own HTML block renderer plus the source range on
// a <details> opener. goldmark keeps an HTML block as one opaque blob, so the
// attributes have to go into the raw text rather than onto the node.
type detailsRenderer struct{}

func (r *detailsRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(ast.KindHTMLBlock, r.render)
}

func (r *detailsRenderer) render(
	w util.BufWriter, source []byte, node ast.Node, entering bool,
) (ast.WalkStatus, error) {
	n := node.(*ast.HTMLBlock)
	if !entering {
		if n.HasClosure() {
			html.DefaultWriter.SecureWrite(w, n.ClosureLine.Value(source))
		}
		return ast.WalkContinue, nil
	}
	lines := n.Lines()
	for i := range lines.Len() {
		segment := lines.At(i)
		line := segment.Value(source)
		if i == 0 {
			line = withSrcRange(line, node)
		}
		html.DefaultWriter.SecureWrite(w, line)
	}
	return ast.WalkContinue, nil
}

// withSrcRange puts the node's source range into the opening tag of a raw line.
func withSrcRange(line []byte, n ast.Node) []byte {
	at := reDetailsTag.FindIndex(line)
	if at == nil {
		return line
	}
	out := make([]byte, 0, len(line)+64)
	out = append(out, line[:at[1]]...)
	for _, name := range srcRangeAttrs {
		value, ok := n.AttributeString(name)
		if !ok {
			return line
		}
		digits, ok := value.([]byte)
		if !ok {
			return line
		}
		out = append(out, ' ')
		out = append(out, name...)
		out = append(out, `="`...)
		out = append(out, digits...)
		out = append(out, '"')
	}
	return append(out, line[at[1]:]...)
}
