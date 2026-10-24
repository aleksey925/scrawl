package htmldiff

import (
	"cmp"
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
// text the way elementMarker puts it. In code, gap is the text between it and
// the token before it, which can only be line breaks there.
type token struct {
	text       string
	node       *html.Node
	start, end int
	element    bool
	gap        string
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
	var gap strings.Builder
	add := func(tok token, inPre bool) {
		if inPre {
			tok.gap = gap.String()
		}
		gap.Reset()
		res = append(res, tok)
	}
	var walk func(node *html.Node, inPre bool)
	walk = func(node *html.Node, inPre bool) {
		switch node.Type {
		case html.TextNode:
			re := reWord
			if inPre {
				re = reCodeWord
			}
			pos := 0
			for _, loc := range re.FindAllStringIndex(node.Data, -1) {
				if inPre {
					gap.WriteString(node.Data[pos:loc[0]])
				}
				add(token{text: node.Data[loc[0]:loc[1]], node: node, start: loc[0], end: loc[1]}, inPre)
				pos = loc[1]
			}
			if inPre {
				gap.WriteString(node.Data[pos:])
			}
			return
		case html.ElementNode:
			if skipText[node.DataAtom] {
				return
			}
			if marker := elementMarker(node); marker != "" {
				add(token{text: marker, node: node, element: true}, inPre)
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
	var places []place
	for _, edit := range ops {
		if edit.kind == opReplace || edit.kind == opInsert {
			inss = appendRange(inss, edit.j1, edit.j2)
		}
		if edit.kind == opReplace || edit.kind == opDelete {
			if p, ok := lostPlace(ta, edit, len(tb)); ok {
				places = append(places, p)
			}
		}
	}
	// from the end backwards, so a split never moves a place not yet used
	slices.SortStableFunc(places, func(a, b place) int { return cmp.Compare(b.order(), a.order()) })
	for _, p := range places {
		putBack(tb, curNode, p)
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

// place is where words a block lost go back into the new block: in front of
// the token at, or right after it, kept apart from it by sep
type place struct {
	at    int
	after bool
	words string
	sep   string
}

func (p place) order() int {
	if p.after {
		return 2*p.at + 1
	}
	return 2 * p.at
}

// lostPlace is where the words an edit took out of the old block go back. A
// space keeps them apart from the new words, except in code, where a space and
// a line break are part of the text: there the words take the breaks around
// them along, and stand at the end of a line when a break followed them.
func lostPlace(ta []token, edit opcode, curLen int) (place, bool) {
	lost := ta[edit.i1:edit.i2]
	if !slices.ContainsFunc(lost, func(tok token) bool { return !tok.element }) {
		return place{}, false
	}
	if !insidePre(lost[0].node) {
		if edit.j1 < curLen || curLen == 0 {
			return place{at: edit.j1, words: spoken(lost), sep: " "}, true
		}
		return place{at: curLen - 1, after: true, words: spoken(lost), sep: " "}, true
	}
	endsLine := edit.i2 == len(ta) || strings.ContainsAny(ta[edit.i2].gap, "\n\r")
	if edit.j1 > 0 && (endsLine || edit.j1 == curLen) {
		return place{at: edit.j1 - 1, after: true, words: codeText(lost, true)}, true
	}
	words := codeText(lost, false)
	if edit.i2 < len(ta) {
		words += ta[edit.i2].gap
	}
	return place{at: edit.j1, words: words}, true
}

// codeText is the source of a run of code tokens with the line breaks between
// them, and the breaks before the first one when leading
func codeText(tokens []token, leading bool) string {
	var sb strings.Builder
	for i, tok := range tokens {
		if i > 0 || leading {
			sb.WriteString(tok.gap)
		}
		if !tok.element {
			sb.WriteString(tok.text)
		}
	}
	return sb.String()
}

// putBack puts lost words back as a struck mark at their place, and keeps the
// tokens pointing at the text they were read from
func putBack(tokens []token, root *html.Node, p place) {
	mark := &html.Node{
		Type: html.ElementNode, Data: atom.Del.String(), DataAtom: atom.Del,
		Attr: []html.Attribute{{Key: "class", Val: DelClass}},
	}
	mark.AppendChild(&html.Node{Type: html.TextNode, Data: p.words})
	if len(tokens) == 0 {
		root.AppendChild(mark)
		return
	}
	added := []*html.Node{mark}
	if p.sep != "" {
		sep := &html.Node{Type: html.TextNode, Data: p.sep}
		if p.after {
			added = []*html.Node{sep, mark}
		} else {
			added = append(added, sep)
		}
	}

	parent, ref := placeOf(tokens, root, p)
	for _, node := range added {
		parent.InsertBefore(node, ref)
	}
}

// placeOf is the node to insert in front of for a place, and its parent; a nil
// node appends
func placeOf(tokens []token, root *html.Node, p place) (parent, ref *html.Node) {
	tok := tokens[p.at]
	if p.after {
		if !tok.element {
			if rest := splitText(tokens, tok.node, tok.end); rest != nil {
				return rest.Parent, rest
			}
		}
		if tok.node.Parent == nil {
			return root, nil
		}
		return tok.node.Parent, tok.node.NextSibling
	}
	ref = tok.node
	if !tok.element {
		if rest := splitText(tokens, tok.node, tok.start); rest != nil {
			ref = rest
		}
	}
	if ref.Parent == nil {
		return root, root.FirstChild
	}
	return ref.Parent, ref
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
