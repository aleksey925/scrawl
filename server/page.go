package server

import (
	"html/template"
	"log"
	"path"
	"strings"

	"github.com/aleksey925/scrawl/view"
)

type LoginPage struct {
	SiteTitle string
	Version   string
	AppThemes string
	Logo      template.HTML
	Favicon   string
	Theme     pageTheme
	Themes    string
	Error     string
	From      string
}

func (m *mount) treeNodes(current string) []view.NavNode {
	if m.spc.Store == nil {
		return []view.NavNode{}
	}
	root, err := m.spc.Store.Tree()
	if err != nil {
		log.Printf("[WARN] build tree: %v", err)
		return []view.NavNode{}
	}
	return view.Nav(root, current)
}

func isMarkdown(p string) bool { return strings.EqualFold(path.Ext(p), ".md") }
