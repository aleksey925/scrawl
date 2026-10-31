package render

import (
	"bytes"
	"regexp"
	"strings"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

var reAlertMarker = regexp.MustCompile(`^\[!([A-Za-z]{1,16})\]$`)

var alertTitles = map[string]string{
	"note":      "Note",
	"tip":       "Tip",
	"important": "Important",
	"warning":   "Warning",
	"caution":   "Caution",
}

var kindAlert = ast.NewNodeKind("Alert")

type alert struct {
	ast.BaseBlock
	kind  string
	title string
	start int
}

func (n *alert) Kind() ast.NodeKind { return kindAlert }

func (n *alert) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, map[string]string{"Kind": n.kind}, nil)
}

type alertTransformer struct{}

func (t *alertTransformer) Transform(doc *ast.Document, reader text.Reader, _ parser.Context) {
	source := reader.Source()
	var quotes []*ast.Blockquote
	for child := doc.FirstChild(); child != nil; child = child.NextSibling() {
		if quote, ok := child.(*ast.Blockquote); ok {
			quotes = append(quotes, quote)
		}
	}
	for _, quote := range quotes {
		convertAlert(doc, quote, source)
	}
}

func convertAlert(doc *ast.Document, quote *ast.Blockquote, source []byte) {
	para, ok := quote.FirstChild().(*ast.Paragraph)
	if !ok || para.Lines().Len() == 0 {
		return
	}
	first := para.Lines().At(0)
	m := reAlertMarker.FindSubmatch(bytes.TrimRight(first.Value(source), " \t\r\n"))
	if m == nil {
		return
	}
	marker := strings.ToLower(string(m[1]))
	title, known := alertTitles[marker]
	if !known {
		return
	}
	if para.Lines().Len() == 1 && quote.ChildCount() == 1 {
		return
	}
	dropFirstLine(para)

	node := &alert{kind: marker, title: title, start: first.Start}
	doc.ReplaceChild(doc, quote, node)
	for child := quote.FirstChild(); child != nil; child = quote.FirstChild() {
		quote.RemoveChild(quote, child)
		node.AppendChild(node, child)
	}
}

func dropFirstLine(para *ast.Paragraph) {
	for child := para.FirstChild(); child != nil; child = para.FirstChild() {
		para.RemoveChild(para, child)
		if txt, ok := child.(*ast.Text); ok && (txt.SoftLineBreak() || txt.HardLineBreak()) {
			para.Lines().SetSliced(1, para.Lines().Len())
			return
		}
	}
	para.Parent().RemoveChild(para.Parent(), para)
}

type alertRenderer struct{}

func (r *alertRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(kindAlert, r.render)
}

func (r *alertRenderer) render(
	w util.BufWriter, _ []byte, node ast.Node, entering bool,
) (ast.WalkStatus, error) {
	if !entering {
		_, _ = w.WriteString("</div>\n")
		return ast.WalkContinue, nil
	}
	n := node.(*alert)
	_, _ = w.WriteString(`<div class="alert alert-`)
	_, _ = w.WriteString(n.kind)
	_ = w.WriteByte('"')
	writeSrcRange(w, node)
	_, _ = w.WriteString(">\n<p class=\"alert-title\">")
	_, _ = w.WriteString(n.title)
	_, _ = w.WriteString("</p>\n")
	return ast.WalkContinue, nil
}
