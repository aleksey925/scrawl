package server

import (
	"html/template"
	"log"
	"path"
	"strings"

	"github.com/aleksey925/scrawl/view"
)

// LoginPage renders the sign-in form. It carries no Base, because it is served
// before there is a session and must not expose the tree.
type LoginPage struct {
	SiteTitle string
	Version   string
	Logo      template.HTML
	Theme     pageTheme
	// Themes is every theme as JSON, for the toggle's script
	Themes string
	Error  string
	From   string
}

// treeNodes is the sidebar tree with the branch to current marked. A tree that
// cannot be built is logged and left empty: the page itself is still worth
// serving without its navigation.
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
