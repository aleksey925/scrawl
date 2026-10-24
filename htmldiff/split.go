package htmldiff

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

type block struct {
	html  string
	key   string
	text  string
	tag   string
	start int
	end   int
	node  *html.Node
}

const (
	srcStartAttr = "data-source-start"
	srcEndAttr   = "data-source-end"
)

var volatileAttrs = map[string]bool{
	"id": true, "name": true, "for": true, srcStartAttr: true, srcEndAttr: true,
}

var blockTags = map[atom.Atom]bool{
	atom.P: true, atom.Div: true, atom.Li: true, atom.Ul: true, atom.Ol: true, atom.Table: true,
	atom.Thead: true, atom.Tbody: true, atom.Tr: true, atom.Td: true, atom.Th: true,
	atom.H1: true, atom.H2: true, atom.H3: true, atom.H4: true, atom.H5: true, atom.H6: true,
	atom.Pre: true, atom.Blockquote: true, atom.Dl: true, atom.Dt: true, atom.Dd: true,
	atom.Details: true, atom.Summary: true, atom.Br: true, atom.Hr: true, atom.Figure: true,
	atom.Figcaption: true, atom.Section: true, atom.Aside: true,
}

var skipText = map[atom.Atom]bool{atom.Script: true, atom.Style: true, atom.Template: true}

func split(fragment string) ([]block, error) {
	nodes, err := html.ParseFragment(strings.NewReader(fragment), &html.Node{
		Type: html.ElementNode, Data: "body", DataAtom: atom.Body,
	})
	if err != nil {
		return nil, fmt.Errorf("parse: %w", err)
	}

	res := make([]block, 0, len(nodes))
	for _, node := range nodes {
		switch node.Type {
		case html.TextNode:
			if strings.TrimSpace(node.Data) == "" {
				continue
			}
			para := &html.Node{Type: html.ElementNode, Data: "p", DataAtom: atom.P}
			para.AppendChild(node)
			node = para
		case html.ElementNode:
		default:
			continue
		}
		blk, err := newBlock(node)
		if err != nil {
			return nil, err
		}
		if blk.tag == "p" && blk.key == "" {
			continue
		}
		res = append(res, blk)
	}
	return res, nil
}

func newBlock(node *html.Node) (block, error) {
	start, end := lineAttr(node, srcStartAttr), lineAttr(node, srcEndAttr)
	tidy(node)
	markup, err := renderNode(node)
	if err != nil {
		return block{}, err
	}
	key, text := textOf(node)
	return block{html: markup, key: key, text: text, tag: node.Data, start: start, end: end, node: node}, nil
}

func lineAttr(node *html.Node, name string) int {
	for _, attr := range node.Attr {
		if attr.Key == name {
			n, err := strconv.Atoi(attr.Val)
			if err == nil && n > 0 {
				return n
			}
		}
	}
	return 0
}

func tidy(node *html.Node) {
	if node.Type == html.ElementNode {
		kept := node.Attr[:0]
		for _, attr := range node.Attr {
			if !volatileAttrs[attr.Key] {
				kept = append(kept, attr)
			}
		}
		node.Attr = kept
		if node.DataAtom == atom.Details && !hasAttr(node, "open") {
			node.Attr = append(node.Attr, html.Attribute{Key: "open"})
		}
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		tidy(child)
	}
}

func hasAttr(node *html.Node, name string) bool {
	for _, attr := range node.Attr {
		if attr.Key == name {
			return true
		}
	}
	return false
}

func attrOf(node *html.Node, name string) string {
	for _, attr := range node.Attr {
		if attr.Key == name {
			return attr.Val
		}
	}
	return ""
}

func renderNode(node *html.Node) (string, error) {
	var sb strings.Builder
	if err := html.Render(&sb, node); err != nil {
		return "", fmt.Errorf("render: %w", err)
	}
	return sb.String(), nil
}

func textOf(root *html.Node) (key, text string) {
	var keyB, textB strings.Builder
	var walk func(node *html.Node, inPre bool)
	walk = func(node *html.Node, inPre bool) {
		switch node.Type {
		case html.TextNode:
			textB.WriteString(node.Data)
			if inPre {
				keyB.WriteString(verbatim(node.Data))
			} else {
				keyB.WriteString(node.Data)
			}
			return
		case html.ElementNode:
			if skipText[node.DataAtom] {
				return
			}
			if marker := elementMarker(node); marker != "" {
				keyB.WriteString(" " + marker + " ")
				textB.WriteString(" " + marker + " ")
			}
			if blockTags[node.DataAtom] {
				keyB.WriteByte(' ')
				textB.WriteByte(' ')
			}
			inPre = inPre || node.DataAtom == atom.Pre
		default:
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child, inPre)
		}
		if node.Type == html.ElementNode && blockTags[node.DataAtom] {
			keyB.WriteByte(' ')
			textB.WriteByte(' ')
		}
	}
	walk(root, false)
	return collapse(keyB.String()), collapse(textB.String())
}

func elementMarker(node *html.Node) string {
	switch node.DataAtom {
	case atom.A:
		if href := attrOf(node, "href"); href != "" {
			return "[link " + href + "]"
		}
	case atom.Img:
		return "[img " + attrOf(node, "src") + " " + attrOf(node, "alt") + "]"
	default:
	}
	return ""
}

var reSpace = regexp.MustCompile(`\s+`)

func collapse(s string) string {
	return strings.TrimSpace(reSpace.ReplaceAllString(s, " "))
}

var verbatim = strings.NewReplacer(" ", "\uE000", "\t", "\uE001", "\n", "\uE002", "\r", "").Replace
