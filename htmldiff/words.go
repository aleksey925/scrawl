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
func markWords(left, right block, ta, tb []token, ops []opcode) (string, string) {
	var dels, inss []int
	for _, edit := range ops {
		if edit.kind == opReplace || edit.kind == opDelete {
			dels = appendRange(dels, edit.i1, edit.i2)
		}
		if edit.kind == opReplace || edit.kind == opInsert {
			inss = appendRange(inss, edit.j1, edit.j2)
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

func textsOf(tokens []token) []string {
	res := make([]string, len(tokens))
	for i, tok := range tokens {
		res[i] = tok.text
	}
	return res
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

// inlineWords is one block that changed shown once: the new block with its
// added words marked and the words it lost put back in front of them, struck
// out, the way a reader follows an edit in one column. ta are the tokens of the
// old block and ops their word diff against the new one. It is "" when the new
// block cannot be read again.
func inlineWords(right block, ta []token, ops []opcode) string {
	curNode := reparse(right)
	if curNode == nil {
		return ""
	}
	tb := tokensOf(curNode)

	var inss []int
	lost := map[int]string{}
	var at []int
	for _, edit := range ops {
		if edit.kind == opReplace || edit.kind == opInsert {
			inss = appendRange(inss, edit.j1, edit.j2)
		}
		if edit.kind == opReplace || edit.kind == opDelete {
			if words := spoken(ta[edit.i1:edit.i2]); words != "" {
				if _, seen := lost[edit.j1]; !seen {
					at = append(at, edit.j1)
				}
				lost[edit.j1] += words
			}
		}
	}
	// from the end backwards, so a split never moves a place not yet used
	slices.Sort(at)
	for k := len(at) - 1; k >= 0; k-- {
		putBack(tb, curNode, at[k], lost[at[k]])
	}
	applyMarks(tb, inss, atom.Ins, InsClass)

	res, err := renderNode(curNode)
	if err != nil {
		return ""
	}
	return res
}

// reparse reads a block's markup again into a tree of its own, which marks
// can be put into without touching the block
func reparse(blk block) *html.Node {
	blocks, err := split(blk.html)
	if err != nil || len(blocks) != 1 {
		return nil
	}
	return blocks[0].node
}

// spoken is the text of a run of tokens as it read, one space between words
// that were apart, without the markers that stand for an element
func spoken(tokens []token) string {
	var sb strings.Builder
	for i, tok := range tokens {
		if tok.element {
			continue
		}
		if sb.Len() > 0 {
			prev := tokens[i-1]
			if prev.node != tok.node || prev.end < tok.start {
				sb.WriteByte(' ')
			}
		}
		sb.WriteString(tok.text)
	}
	return sb.String()
}

// putBack puts the lost words in front of the token at, or after the last one
// when at is past the end, as a struck mark and a space, and keeps the tokens
// pointing at the text they were read from
func putBack(tokens []token, root *html.Node, at int, words string) {
	mark := &html.Node{
		Type: html.ElementNode, Data: atom.Del.String(), DataAtom: atom.Del,
		Attr: []html.Attribute{{Key: "class", Val: DelClass}},
	}
	mark.AppendChild(&html.Node{Type: html.TextNode, Data: words})
	// a space keeps the lost words apart from the new ones, except in code,
	// where a space is part of the text
	gap := " "
	if len(tokens) > 0 && insidePre(tokens[min(at, len(tokens)-1)].node) {
		gap = ""
	}
	space := func() *html.Node { return &html.Node{Type: html.TextNode, Data: gap} }

	if len(tokens) == 0 {
		root.AppendChild(mark)
		return
	}
	if at >= len(tokens) {
		last := tokens[len(tokens)-1]
		if !last.element {
			if rest := splitText(tokens, last.node, last.end); rest != nil {
				rest.Parent.InsertBefore(space(), rest)
				rest.Parent.InsertBefore(mark, rest)
				return
			}
		}
		if last.node.Parent == nil {
			root.AppendChild(space())
			root.AppendChild(mark)
			return
		}
		sep := space()
		insertAfter(last.node, sep)
		insertAfter(sep, mark)
		return
	}
	tok := tokens[at]
	before := tok.node
	if !tok.element {
		if rest := splitText(tokens, tok.node, tok.start); rest != nil {
			before = rest
		}
	}
	if before.Parent == nil {
		first := root.FirstChild
		root.InsertBefore(mark, first)
		root.InsertBefore(space(), first)
		return
	}
	before.Parent.InsertBefore(mark, before)
	before.Parent.InsertBefore(space(), before)
}

// splitText cuts a text node at offset and returns the node holding the rest,
// moving the tokens read from the rest onto it; it is nil when nothing follows
// the cut, and the node itself when nothing comes before it
func splitText(tokens []token, node *html.Node, offset int) *html.Node {
	if offset >= len(node.Data) {
		return nil
	}
	if offset == 0 {
		return node
	}
	rest := &html.Node{Type: html.TextNode, Data: node.Data[offset:]}
	node.Data = node.Data[:offset]
	insertAfter(node, rest)
	for i := range tokens {
		if tokens[i].node == node && !tokens[i].element && tokens[i].start >= offset {
			tokens[i].node = rest
			tokens[i].start -= offset
			tokens[i].end -= offset
		}
	}
	return rest
}

func insertAfter(node, added *html.Node) {
	if node.NextSibling == nil {
		node.Parent.AppendChild(added)
		return
	}
	node.Parent.InsertBefore(added, node.NextSibling)
}

func insidePre(node *html.Node) bool {
	for n := node; n != nil; n = n.Parent {
		if n.DataAtom == atom.Pre {
			return true
		}
	}
	return false
}
