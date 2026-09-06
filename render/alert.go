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

// GitHub turns a blockquote whose very first line is one of five markers into
// an alert, replacing the blockquote rather than nesting inside it. Every rule
// below was checked against api.github.com/markdown in "gfm" mode:
//
//   - the marker line carries nothing but the marker, trailing spaces aside,
//     so "> [!NOTE] text" is an ordinary blockquote and the trailing text is
//     never a custom title;
//   - the marker is matched case-insensitively;
//   - the marker has to be the first line, so a marker on a later line is
//     ordinary text;
//   - an unknown marker such as "[!FOO]" is ordinary text;
//   - a marker with no body stays a blockquote: an alert needs content;
//   - the blockquote has to be top level. GitHub documents that "alerts cannot
//     be nested within other elements", and neither "> > [!NOTE]" nor a
//     blockquote inside a list item becomes one.
var reAlertMarker = regexp.MustCompile(`^\[!([A-Za-z]{1,16})\]$`)

// alertTitles maps a marker onto GitHub's own wording for the title.
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
	kind  string // lowercase marker, always a key of alertTitles
	title string
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

// convertAlert replaces a blockquote with an alert node when its first line is
// a known marker. The marker line is dropped from the body.
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
	// the marker alone is not an alert, so the blockquote has to hold
	// something else: more lines in the opening paragraph, or another block
	if para.Lines().Len() == 1 && quote.ChildCount() == 1 {
		return
	}
	dropFirstLine(para)

	node := &alert{kind: marker, title: title}
	doc.ReplaceChild(doc, quote, node)
	for child := quote.FirstChild(); child != nil; child = quote.FirstChild() {
		quote.RemoveChild(quote, child)
		node.AppendChild(node, child)
	}
}

// dropFirstLine removes the marker line from the paragraph that opens the
// alert. Everything up to and including the first line break belongs to that
// line, a hard one included: trailing spaces on the marker line are allowed and
// turn the break into a hard one. With no break at all the marker was the whole
// paragraph and the paragraph goes away with it.
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
	_, _ = w.WriteString("\">\n<p class=\"alert-title\">")
	_, _ = w.WriteString(n.title)
	_, _ = w.WriteString("</p>\n")
	return ast.WalkContinue, nil
}
