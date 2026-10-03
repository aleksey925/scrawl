package render

import (
	"strings"

	"github.com/yuin/goldmark/ast"
)

// tocMaxLevel is the deepest heading the outline collects. The corpus has 31
// h5 headings that would only add noise to a 112-entry rail. Which of the
// collected levels reach the reader is the server's call.
const tocMaxLevel = 4

// outline walks the document once and returns the title, which is the first
// level-1 heading, and every heading down to tocMaxLevel.
func outline(doc ast.Node, source []byte) (title string, toc []Heading) {
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		h, ok := n.(*ast.Heading)
		if !ok {
			return ast.WalkContinue, nil
		}
		txt := headingText(h, source)
		if title == "" && h.Level == 1 {
			title = txt
		}
		if h.Level <= tocMaxLevel {
			toc = append(toc, Heading{Level: h.Level, Text: txt, ID: headingID(h)})
		}
		return ast.WalkSkipChildren, nil
	})
	return title, toc
}

func headingID(h *ast.Heading) string {
	v, ok := h.AttributeString("id")
	if !ok {
		return ""
	}
	if b, ok := v.([]byte); ok {
		return string(b)
	}
	return ""
}

// headingText is the plain text of a heading: inline markup unwrapped and raw
// HTML dropped, so a heading that swallowed an <a name='...'></a> line still
// reads correctly in the sidebar.
func headingText(n ast.Node, source []byte) string {
	var b strings.Builder
	_ = ast.Walk(n, func(c ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch v := c.(type) {
		case *ast.Text:
			b.Write(v.Value(source))
			if v.SoftLineBreak() || v.HardLineBreak() {
				b.WriteByte(' ')
			}
		case *ast.String:
			b.Write(v.Value)
		case *ast.AutoLink:
			b.Write(v.Label(source))
		case *ast.CodeSpan:
			for ch := v.FirstChild(); ch != nil; ch = ch.NextSibling() {
				if t, ok := ch.(*ast.Text); ok {
					b.Write(t.Value(source))
				}
			}
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})
	return strings.TrimSpace(b.String())
}
