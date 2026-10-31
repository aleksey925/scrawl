package htmldiff

import (
	"fmt"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

type Kind string

const (
	Same    Kind = "same"
	Format  Kind = "format"
	Changed Kind = "changed"
	Added   Kind = "added"
	Removed Kind = "removed"
)

type Document struct {
	Frontmatter string
	HTML        string
}

type Side struct {
	HTML  string `json:"html"`
	Start int    `json:"start,omitempty"`
	End   int    `json:"end,omitempty"`
}

type Row struct {
	Kind   Kind  `json:"kind"`
	Old    *Side `json:"old,omitempty"`
	New    *Side `json:"new,omitempty"`
	Inline *Side `json:"inline,omitempty"`
}

type Stats struct {
	Added   int `json:"added"`
	Removed int `json:"removed"`
	Changed int `json:"changed"`
}

func (s Stats) Empty() bool { return s.Added == 0 && s.Removed == 0 && s.Changed == 0 }

func Count(rows []Row) Stats {
	var res Stats
	for _, row := range rows {
		switch row.Kind {
		case Added:
			res.Added++
		case Removed:
			res.Removed++
		case Changed:
			res.Changed++
		case Same, Format:
		}
	}
	return res
}

func Diff(old, cur Document) ([]Row, error) {
	oldBlocks, err := blocksOf(old)
	if err != nil {
		return nil, fmt.Errorf("htmldiff: old side: %w", err)
	}
	curBlocks, err := blocksOf(cur)
	if err != nil {
		return nil, fmt.Errorf("htmldiff: new side: %w", err)
	}
	return align(oldBlocks, curBlocks), nil
}

func blocksOf(doc Document) ([]block, error) {
	res, err := split(doc.HTML)
	if err != nil {
		return nil, err
	}
	if doc.Frontmatter == "" {
		return res, nil
	}
	fm, err := frontmatterBlock(doc.Frontmatter)
	if err != nil {
		return nil, err
	}
	return append([]block{fm}, res...), nil
}

const frontmatterClass = "frontmatter"

func frontmatterBlock(src string) (block, error) {
	code := &html.Node{Type: html.ElementNode, Data: "code", DataAtom: atom.Code}
	code.AppendChild(&html.Node{Type: html.TextNode, Data: strings.TrimRight(src, "\n")})
	pre := &html.Node{
		Type: html.ElementNode, Data: "pre", DataAtom: atom.Pre,
		Attr: []html.Attribute{{Key: "class", Val: frontmatterClass}},
	}
	pre.AppendChild(code)
	blk, err := newBlock(pre)
	if err != nil {
		return block{}, err
	}
	blk.tag, blk.start, blk.end = frontmatterClass, 1, strings.Count(code.FirstChild.Data, "\n")+1
	return blk, nil
}
