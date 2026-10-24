package render

import (
	"strconv"

	"github.com/yuin/goldmark/ast"
	east "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/util"
)

const footnoteBacklinkGlyph = "↩"

type footnoteRenderer struct{}

func (r *footnoteRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(east.KindFootnoteLink, r.renderLink)
	reg.Register(east.KindFootnoteBacklink, r.renderBacklink)
	reg.Register(east.KindFootnote, r.renderFootnote)
	reg.Register(east.KindFootnoteList, r.renderList)
}

func (r *footnoteRenderer) renderLink(
	w util.BufWriter, _ []byte, node ast.Node, entering bool,
) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	n := node.(*east.FootnoteLink)
	index := strconv.Itoa(n.Index)
	_, _ = w.WriteString(`<sup class="footnote-ref"><a href="#fn-`)
	_, _ = w.WriteString(index)
	_, _ = w.WriteString(`" id="`)
	_, _ = w.WriteString(footnoteRefID(n.Index, n.RefIndex))
	_, _ = w.WriteString(`">`)
	_, _ = w.WriteString(index)
	_, _ = w.WriteString(`</a></sup>`)
	return ast.WalkContinue, nil
}

func (r *footnoteRenderer) renderBacklink(
	w util.BufWriter, _ []byte, node ast.Node, entering bool,
) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	n := node.(*east.FootnoteBacklink)
	_, _ = w.WriteString(`&#160;<a href="#`)
	_, _ = w.WriteString(footnoteRefID(n.Index, n.RefIndex))
	_, _ = w.WriteString(`" class="footnote-back">`)
	_, _ = w.WriteString(footnoteBacklinkGlyph)
	if n.RefIndex > 0 {
		_, _ = w.WriteString("<sup>")
		_, _ = w.WriteString(strconv.Itoa(n.RefIndex + 1))
		_, _ = w.WriteString("</sup>")
	}
	_, _ = w.WriteString(`</a>`)
	return ast.WalkContinue, nil
}

func (r *footnoteRenderer) renderFootnote(
	w util.BufWriter, _ []byte, node ast.Node, entering bool,
) (ast.WalkStatus, error) {
	if !entering {
		_, _ = w.WriteString("</li>\n")
		return ast.WalkContinue, nil
	}
	n := node.(*east.Footnote)
	_, _ = w.WriteString(`<li id="fn-`)
	_, _ = w.WriteString(strconv.Itoa(n.Index))
	_, _ = w.WriteString("\">\n")
	return ast.WalkContinue, nil
}

func (r *footnoteRenderer) renderList(
	w util.BufWriter, _ []byte, _ ast.Node, entering bool,
) (ast.WalkStatus, error) {
	if entering {
		_, _ = w.WriteString("<section class=\"footnotes\">\n<ol>\n")
	} else {
		_, _ = w.WriteString("</ol>\n</section>\n")
	}
	return ast.WalkContinue, nil
}

func footnoteRefID(index, refIndex int) string {
	id := "fnref-" + strconv.Itoa(index)
	if refIndex > 0 {
		id += "-" + strconv.Itoa(refIndex+1)
	}
	return id
}
