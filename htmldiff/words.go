package htmldiff

import (
	"regexp"
	"slices"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// The classes the marks of a changed block carry. A note can write a <del>
// and an <ins> of its own, so the class is what tells a mark from content.
const (
	DelClass = "diff-del"
	InsClass = "diff-ins"
)

// maxTokens bounds the word diff of one pair of blocks. The matcher slows down
// on long runs of repeated tokens, which is what a big code block is, so past
// this the pair is shown as changed with no word marked.
const maxTokens = 5000

var (
	// a word, its apostrophes included, or a single sign of anything else
	reWord = regexp.MustCompile(`[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*|[^\p{L}\p{N}\p{M}\s]`)
	// the same in a code block, where a changed indent is a change too
	reCodeWord = regexp.MustCompile(`[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*|[^\p{L}\p{N}\p{M}\s]|[ \t]+`)
)

// token is a word of a text node, or an element whose target is part of the
// text the way elementMarker puts it.
type token struct {
	text       string
	node       *html.Node
	start, end int
	element    bool
}

// markWords marks the words a pair of blocks does not share, in place on the
// parsed trees, and returns both rendered again.
func markWords(left, right block) (string, string) {
	ta, tb := tokensOf(left.node), tokensOf(right.node)
	if len(ta) > maxTokens || len(tb) > maxTokens {
		return left.html, right.html
	}
	texts := func(tokens []token) []string {
		res := make([]string, len(tokens))
		for i, tok := range tokens {
			res[i] = tok.text
		}
		return res
	}

	var dels, inss []int
	for _, op := range opcodes(texts(ta), texts(tb)) {
		if op.kind == opReplace || op.kind == opDelete {
			dels = appendRange(dels, op.i1, op.i2)
		}
		if op.kind == opReplace || op.kind == opInsert {
			inss = appendRange(inss, op.j1, op.j2)
		}
	}
	applyMarks(ta, dels, atom.Del, DelClass)
	applyMarks(tb, inss, atom.Ins, InsClass)

	oldHTML, errOld := renderNode(left.node)
	newHTML, errNew := renderNode(right.node)
	if errOld != nil || errNew != nil {
		return left.html, right.html
	}
	return oldHTML, newHTML
}

func appendRange(dst []int, from, to int) []int {
	for i := from; i < to; i++ {
		dst = append(dst, i)
	}
	return dst
}

func tokensOf(root *html.Node) []token {
	res := []token{}
	var walk func(node *html.Node, inPre bool)
	walk = func(node *html.Node, inPre bool) {
		switch node.Type {
		case html.TextNode:
			re := reWord
			if inPre {
				re = reCodeWord
			}
			for _, loc := range re.FindAllStringIndex(node.Data, -1) {
				res = append(res, token{text: node.Data[loc[0]:loc[1]], node: node, start: loc[0], end: loc[1]})
			}
			return
		case html.ElementNode:
			if skipText[node.DataAtom] {
				return
			}
			if marker := elementMarker(node); marker != "" {
				res = append(res, token{text: marker, node: node, element: true})
			}
			inPre = inPre || node.DataAtom == atom.Pre
		default:
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child, inPre)
		}
	}
	walk(root, false)
	return res
}

// run is a stretch of one text node to wrap in a mark: a run of changed words
// next to each other is one mark, the spaces between them included.
type run struct {
	start, end int
	last       int
}

func applyMarks(tokens []token, changed []int, tag atom.Atom, class string) {
	runs := map[*html.Node][]run{}
	order := []*html.Node{}
	for _, idx := range changed {
		tok := tokens[idx]
		if tok.element {
			addClass(tok.node, class)
			continue
		}
		spans := runs[tok.node]
		if n := len(spans); n > 0 && spans[n-1].last == idx-1 {
			spans[n-1].end, spans[n-1].last = tok.end, idx
		} else {
			if spans == nil {
				order = append(order, tok.node)
			}
			spans = append(spans, run{start: tok.start, end: tok.end, last: idx})
		}
		runs[tok.node] = spans
	}
	for _, node := range order {
		wrapRuns(node, runs[node], tag, class)
	}
}

func wrapRuns(node *html.Node, spans []run, tag atom.Atom, class string) {
	parent, text, pos := node.Parent, node.Data, 0
	if parent == nil {
		return
	}
	for _, sp := range spans {
		if sp.start > pos {
			parent.InsertBefore(&html.Node{Type: html.TextNode, Data: text[pos:sp.start]}, node)
		}
		mark := &html.Node{
			Type: html.ElementNode, Data: tag.String(), DataAtom: tag,
			Attr: []html.Attribute{{Key: "class", Val: class}},
		}
		mark.AppendChild(&html.Node{Type: html.TextNode, Data: text[sp.start:sp.end]})
		parent.InsertBefore(mark, node)
		pos = sp.end
	}
	if pos < len(text) {
		parent.InsertBefore(&html.Node{Type: html.TextNode, Data: text[pos:]}, node)
	}
	parent.RemoveChild(node)
}

func addClass(node *html.Node, class string) {
	for i, attr := range node.Attr {
		if attr.Key != "class" {
			continue
		}
		if slices.Contains(strings.Fields(attr.Val), class) {
			return
		}
		node.Attr[i].Val = attr.Val + " " + class
		return
	}
	node.Attr = append(node.Attr, html.Attribute{Key: "class", Val: class})
}
