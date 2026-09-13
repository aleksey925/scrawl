package render

import (
	"github.com/yuin/goldmark/ast"
	east "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// kindTableWrap is the scroll container every table is put into, so a wide
// table scrolls on its own instead of widening the whole page.
var kindTableWrap = ast.NewNodeKind("TableWrap")

type tableWrap struct {
	ast.BaseBlock
}

func (n *tableWrap) Kind() ast.NodeKind { return kindTableWrap }

func (n *tableWrap) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, nil, nil)
}

type tableWrapTransformer struct{}

func (t *tableWrapTransformer) Transform(doc *ast.Document, _ text.Reader, _ parser.Context) {
	var tables []ast.Node
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if entering && n.Kind() == east.KindTable {
			tables = append(tables, n)
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})
	for _, node := range tables {
		parent := node.Parent()
		if parent == nil {
			continue
		}
		wrap := &tableWrap{}
		parent.ReplaceChild(parent, node, wrap)
		wrap.AppendChild(wrap, node)
	}
}

type tableWrapRenderer struct{}

func (r *tableWrapRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(kindTableWrap, r.render)
}

func (r *tableWrapRenderer) render(
	w util.BufWriter, _ []byte, node ast.Node, entering bool,
) (ast.WalkStatus, error) {
	if !entering {
		_, _ = w.WriteString("</div>\n")
		return ast.WalkContinue, nil
	}
	_, _ = w.WriteString(`<div class="table-wrap"`)
	writeSrcRange(w, node)
	_, _ = w.WriteString(">\n")
	return ast.WalkContinue, nil
}
