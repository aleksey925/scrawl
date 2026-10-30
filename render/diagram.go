package render

import (
	"html"
	"regexp"
	"slices"
	"strings"
)

const (
	mermaidClass  = "mermaid"
	PlantUMLClass = "plantuml"
	endPre        = "</pre>"
)

var (
	preTag    = regexp.MustCompile(`<pre(?:\s[^>]*)?>`)
	classAttr = regexp.MustCompile(`\sclass="([^"]*)"`)
)

type DiagramBlock struct {
	Start  int
	End    int
	Source string
}

func (b DiagramBlock) Text() string {
	return html.UnescapeString(reHTMLTag.ReplaceAllString(b.Source, ""))
}

func DiagramBlocks(fragment, class string) []DiagramBlock {
	var blocks []DiagramBlock
	at := 0
	for {
		tag := preTag.FindStringIndex(fragment[at:])
		if tag == nil {
			return blocks
		}
		start, body := at+tag[0], at+tag[1]
		at = body
		if !hasClass(fragment[start:body], class) {
			continue
		}
		size := strings.Index(fragment[body:], endPre)
		if size < 0 {
			return blocks
		}
		at = body + size + len(endPre)
		blocks = append(blocks, DiagramBlock{Start: start, End: at, Source: fragment[body : body+size]})
	}
}

func hasDiagram(fragment, class string) bool {
	return len(DiagramBlocks(fragment, class)) > 0
}

func hasClass(tag, class string) bool {
	attr := classAttr.FindStringSubmatch(tag)
	return len(attr) == 2 && slices.Contains(strings.Fields(attr[1]), class)
}
