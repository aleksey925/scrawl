// Package htmldiff compares two rendered markdown documents the way a reader
// sees them: block by block and word by word, so that a change to the source
// that leaves the page as it was - a reflowed paragraph, a padded table, a
// formatter's pass - shows as markup only and never as rewritten text.
package htmldiff

import (
	"fmt"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// Kind is what happened to one block.
type Kind string

// The kinds of row a diff consists of.
const (
	// Same is a block that reads and is marked up exactly as before.
	Same Kind = "same"
	// Format is a block that reads as before and is marked up differently:
	// a link to the same place written another way, a code block that gained
	// a language, an emphasis switched from * to _.
	Format Kind = "format"
	// Changed is a block whose text changed, with the changed words marked.
	Changed Kind = "changed"
	Added   Kind = "added"
	Removed Kind = "removed"
)

// Document is one side of a comparison: the rendered HTML of a note and the
// frontmatter the renderer took off it, which a reader does not see on the
// page and which is still a change worth reporting.
type Document struct {
	Frontmatter string
	HTML        string
}

// Side is one block as it is shown in a row: HTML with the changed words
// marked, and the source lines it was rendered from, 0 when unknown.
type Side struct {
	HTML  string `json:"html"`
	Start int    `json:"start,omitempty"`
	End   int    `json:"end,omitempty"`
}

// Row is one block of a diff. Old is nil for an added block, New for a removed
// one, and Inline, a changed block shown once with the words it lost and the
// words it gained both marked, is set on a changed row alone.
type Row struct {
	Kind   Kind  `json:"kind"`
	Old    *Side `json:"old,omitempty"`
	New    *Side `json:"new,omitempty"`
	Inline *Side `json:"inline,omitempty"`
}

// Stats counts the rows that carry a change of text.
type Stats struct {
	Added   int `json:"added"`
	Removed int `json:"removed"`
	Changed int `json:"changed"`
}

// Empty reports that no row carries a change of text, whatever the markup did.
func (s Stats) Empty() bool { return s.Added == 0 && s.Removed == 0 && s.Changed == 0 }

// Count tallies the rows by kind.
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

// Diff compares two documents.
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

// frontmatterClass marks the block that stands for the frontmatter.
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
