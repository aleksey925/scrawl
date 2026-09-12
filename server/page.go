package server

import (
	"html/template"
	"log"
	"net/http"
	"net/url"
	"path"
	"slices"
	"strings"
	"time"

	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/search"
	"github.com/aleksey925/scrawl/store"
)

// themeCookie carries the reader's theme choice, so the server can render the
// right one and the page does not flash on load.
const themeCookie = "theme"

// Crumb is one breadcrumb segment. URL is empty for the last one.
type Crumb struct {
	Name string
	URL  string
}

// TreeNode is what the sidebar renders. Directories come first, then files,
// both sorted by name case-insensitively, which the store already does.
type TreeNode struct {
	Name     string // display name, no extension for .md files
	Path     string // content path, e.g. "python/notes.md"
	URL      string // "/p/python/notes.md" for a file, "/p/python/" for a directory
	IsDir    bool
	Active   bool // on the path to the current page
	Current  bool // is the current page
	Children []TreeNode
}

// Base is embedded in every page struct.
type Base struct {
	SiteTitle   string
	Title       string // page specific part of <title>
	User        string // empty when auth is disabled
	AuthOn      bool
	ReadOnly    bool
	Version     string // asset cache-busting token
	Theme       string // "auto", "light" or "dark"
	Tree        []TreeNode
	Breadcrumbs []Crumb
	CurrentPath string

	HistoryOn       bool // versions of a document can be listed and restored
	HistoryDegraded bool // a change was not recorded, so the list is behind the disk
}

// ViewPage renders one markdown document. TOC holds only the headings the rail
// lists, and ShowTOC decides whether it is rendered at all, so the two cannot
// disagree and leave an empty rail behind.
type ViewPage struct {
	Base
	Content template.HTML
	TOC     []render.Heading
	ShowTOC bool
	Rev     string
	ModTime time.Time
	EditURL string
	Missing bool
}

// tocLevels are the heading levels the outline rail lists. Documents in this
// corpus carry two h1s (the setext title plus a hand written "Contents") and
// the largest one has 112 headings, which is unusable as a flat rail.
var tocLevels = []int{2, 3}

// minTOCHeadings is how many listed headings a document needs before the rail
// earns the space it takes.
const minTOCHeadings = 3

// railTOC keeps the headings the rail renders.
func railTOC(headings []render.Heading) []render.Heading {
	res := make([]render.Heading, 0, len(headings))
	for _, item := range headings {
		if slices.Contains(tocLevels, item.Level) {
			res = append(res, item)
		}
	}
	return res
}

// DirEntry is one row of a directory listing. Path is what the row's actions
// name, which is not derivable from URL once the extension is dropped.
type DirEntry struct {
	Name    string
	Path    string
	URL     string
	IsDir   bool
	Size    int64
	ModTime time.Time
}

// DirPage renders a directory listing.
type DirPage struct {
	Base
	Entries   []DirEntry
	Readme    template.HTML
	HasReadme bool
}

// EditPage renders the editor.
type EditPage struct {
	Base
	Content string
	Rev     string
	ViewURL string
	IsNew   bool
}

// LoginPage renders the sign-in form. It carries no Base, because it is served
// before there is a session and must not expose the tree.
type LoginPage struct {
	SiteTitle string
	Version   string
	Theme     string
	Error     string
	From      string
}

// SearchPage renders full text search results.
type SearchPage struct {
	Base
	Query   string
	Hits    []search.Hit
	Elapsed time.Duration
}

// HistoryPage lists the versions of one document, newest first. Rev is the
// revision the document had when the page was built and a restore sends it
// back, so a page left open cannot silently overwrite an edit it never saw.
type HistoryPage struct {
	Base
	Entries    []historyEntry
	ViewURL    string
	Rev        string
	CanRestore bool
}

// ErrorPage renders a failure as a normal page of the app.
type ErrorPage struct {
	Base
	Code    int
	Message string
}

// base fills the fields every page shares.
func (wb *Web) base(r *http.Request, title, currentPath string) Base {
	res := Base{
		SiteTitle:   wb.Title,
		Title:       title,
		AuthOn:      !wb.AuthDisabled,
		ReadOnly:    wb.ReadOnly,
		Version:     wb.Version,
		Theme:       themeOf(r),
		Tree:        wb.treeNodes(currentPath),
		Breadcrumbs: breadcrumbs(currentPath),
		CurrentPath: currentPath,

		HistoryOn:       wb.history().Enabled(),
		HistoryDegraded: wb.history().Degraded(),
	}
	if wb.Auth != nil {
		res.User, _ = wb.Auth.User(r)
	}
	return res
}

// themeOf reads the theme cookie, falling back to the automatic mode.
func themeOf(r *http.Request) string {
	c, err := r.Cookie(themeCookie)
	if err != nil {
		return "auto"
	}
	switch c.Value {
	case "light", "dark", "auto":
		return c.Value
	}
	return "auto"
}

// treeNodes converts the store tree into what the sidebar template renders. A
// tree that cannot be built is logged and left empty: the page itself is still
// worth serving without its navigation.
func (wb *Web) treeNodes(current string) []TreeNode {
	if wb.Store == nil {
		return nil
	}
	root, err := wb.Store.Tree()
	if err != nil {
		log.Printf("[WARN] build tree: %v", err)
		return nil
	}
	return childNodes(root, current)
}

func childNodes(node *store.Node, current string) []TreeNode {
	res := make([]TreeNode, 0, len(node.Children))
	for _, child := range node.Children {
		if !inNavTree(child) {
			continue
		}
		res = append(res, treeNodeOf(child, current))
	}
	return res
}

// inNavTree reports whether a node belongs in the navigation tree. Every
// directory is kept, empty ones included: the tree is where a folder is created,
// renamed and deleted, and one that only appears once it holds a document
// cannot be any of those things. Files stay markdown only, because an
// attachment belongs to the page beside it rather than to the navigation, and
// keeps its own way in through the directory page and /raw/.
func inNavTree(node *store.Node) bool {
	return node.IsDir || isMarkdown(node.Path)
}

func treeNodeOf(node *store.Node, current string) TreeNode {
	res := TreeNode{Name: displayName(node.Name), Path: node.Path, IsDir: node.IsDir}
	if node.IsDir {
		res.Current = current == node.Path
		res.Active = res.Current || strings.HasPrefix(current, node.Path+"/")
		res.URL = dirURL(node.Path)
		res.Children = childNodes(node, current)
		return res
	}
	res.URL = contentURL(node.Path)
	res.Current = node.Path == current
	return res
}

// breadcrumbs builds the trail for a content path. The last segment carries no
// URL, which is how the template tells the current page from its ancestors.
func breadcrumbs(p string) []Crumb {
	if p == "" {
		return []Crumb{{Name: "Home"}}
	}

	segments := strings.Split(p, "/")
	res := make([]Crumb, 0, len(segments)+1)
	res = append(res, Crumb{Name: "Home", URL: "/"})

	prefix := ""
	for i, seg := range segments {
		prefix = path.Join(prefix, seg)
		crumb := Crumb{Name: displayName(seg)}
		if i < len(segments)-1 {
			crumb.URL = "/p/" + encodePath(prefix) + "/"
		}
		res = append(res, crumb)
	}
	return res
}

// contentURL is where a content path is served from: markdown is rendered,
// everything else is handed over untouched.
func contentURL(p string) string {
	if isMarkdown(p) {
		return "/p/" + encodePath(p)
	}
	return "/raw/" + encodePath(p)
}

// searchURL is where a search hit leads: the document, plus the query that
// found it, which is what marks the match and scrolls to it on arrival.
func searchURL(p, query string) string {
	if query == "" {
		return contentURL(p)
	}
	return contentURL(p) + "?q=" + url.QueryEscape(query)
}

func dirURL(p string) string {
	if p == "" {
		return "/"
	}
	return "/p/" + encodePath(p) + "/"
}

func editURL(p string) string { return "/edit/" + encodePath(p) }

func historyURL(p string) string { return "/history/" + encodePath(p) }

// encodePath escapes a content path segment by segment, so the slashes survive
// and everything else is safe in a URL.
func encodePath(p string) string {
	segments := strings.Split(p, "/")
	for i, seg := range segments {
		segments[i] = url.PathEscape(seg)
	}
	return strings.Join(segments, "/")
}

// displayName drops the markdown extension, which no reader wants to see.
func displayName(name string) string {
	if isMarkdown(name) {
		return name[:len(name)-len(".md")]
	}
	return name
}

func isMarkdown(p string) bool { return strings.EqualFold(path.Ext(p), ".md") }
