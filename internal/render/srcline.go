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

const (
	srcStartAttr = "data-source-start"
	srcEndAttr   = "data-source-end"
)

var srcRangeAttrs = [...]string{srcStartAttr, srcEndAttr}

var srcLinesKey = parser.NewContextKey()

var (
	reDetailsTag    = regexp.MustCompile(`^[ \t]*<details\b`)
	reThematicBreak = regexp.MustCompile(
		`^ {0,3}(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})\r?$`)
)

type srcSpan struct {
	start int
	end   int
}

type srcLines struct {
	starts  []int
	dropped int
}

func newSrcLines(doc document) srcLines {
	starts := []int{0}
	for i, c := range doc.src {
		if c == '\n' {
			starts = append(starts, i+1)
		}
	}
	return srcLines{starts: starts, dropped: doc.dropped}
}

func (s srcLines) at(offset int) int {
	i := sort.SearchInts(s.starts, offset+1) - 1
	if i < 0 {
		return 0
	}
	return s.dropped + i + 1
}

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

func fenceStart(n *ast.FencedCodeBlock, source []byte) (int, bool) {
	if lines := n.Lines(); lines.Len() > 0 {
		return lineStartAbove(source, lines.At(0).Start), true
	}
	if n.Info != nil {
		return n.Info.Segment.Start, true
	}
	return 0, false
}

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

func lineStartAbove(source []byte, offset int) int {
	start := bytes.LastIndexByte(source[:min(offset, len(source))], '\n') + 1
	if start == 0 {
		return 0
	}
	return bytes.LastIndexByte(source[:start-1], '\n') + 1
}

func lineStartBelow(source []byte, offset int) int {
	from := min(offset, len(source))
	at := bytes.IndexByte(source[from:], '\n')
	if at < 0 {
		return len(source)
	}
	return from + at + 1
}

func isFenceLine(source []byte, offset int) bool {
	line := bytes.TrimRight(bytes.TrimLeft(lineAtOffset(source, offset), " \t"), " \t\r")
	if len(line) < 3 || (line[0] != '`' && line[0] != '~') {
		return false
	}
	return len(bytes.Trim(line, string(line[0]))) == 0
}

func writeSrcRange(w util.BufWriter, n ast.Node) {
	for _, name := range srcRangeAttrs {
		if value, ok := n.AttributeString(name); ok {
			writeSrcAttr(w, name, value)
		}
	}
}

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
