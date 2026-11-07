package render

import (
	"bufio"
	"bytes"
	htmlstd "html"
	"slices"
	"strings"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/renderer/html"
)

const tocMaxLevel = 4

var outlineLevels = []int{2, 3}

const MinOutline = 3

func OutlineOf(toc []Heading) []Heading {
	res := make([]Heading, 0, len(toc))
	for _, item := range toc {
		if slices.Contains(outlineLevels, item.Level) {
			res = append(res, item)
		}
	}
	return res
}

func ContentsOf(toc []Heading) []Heading {
	title := titleAt(toc)
	res := make([]Heading, 0, len(toc))
	for i, item := range toc {
		if i != title && reSlugID.MatchString(item.ID) {
			res = append(res, item)
		}
	}
	return res
}

func titleAt(toc []Heading) int {
	return slices.IndexFunc(toc, func(h Heading) bool { return h.Level == 1 })
}

func outline(doc ast.Node, source []byte) (title string, toc []Heading) {
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		h, ok := n.(*ast.Heading)
		if !ok {
			return ast.WalkContinue, nil
		}
		if h.Level <= tocMaxLevel {
			toc = append(toc, Heading{Level: h.Level, Text: headingText(h, source), ID: headingID(h)})
		}
		return ast.WalkSkipChildren, nil
	})
	if at := titleAt(toc); at >= 0 {
		title = toc[at].Text
	}
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

func headingText(n ast.Node, source []byte) string {
	var b strings.Builder
	_ = ast.Walk(n, func(c ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch v := c.(type) {
		case *ast.Text:
			if v.IsRaw() {
				b.Write(v.Value(source))
			} else {
				b.WriteString(unescapedText(v.Value(source)))
			}
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

func unescapedText(value []byte) string {
	var buf bytes.Buffer
	w := bufio.NewWriter(&buf)
	html.DefaultWriter.Write(w, value)
	_ = w.Flush()
	return htmlstd.UnescapeString(buf.String())
}
