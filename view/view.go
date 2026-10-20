// Package view builds what a reader is shown of a space: the answers the app's
// routes send, and that a site writes into its pages, from one set of builders
// so the two can never describe a note differently.
//
// Every URL here is router-relative, which is what the JSON hands the client:
// React Router prepends the space's basename itself, so a prefix written in
// here would produce /s/notes/s/notes/... . The one exception is the /raw/ half
// of ContentURL, which names a route the browser fetches directly; the reading
// side mounts it.
package view

import (
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/store"
)

// the kinds every answer of the view routes carries, so a client tells the
// cases apart by a field and never by the text of an error.
const (
	KindDocument        = "document"
	KindMissingDocument = "missing-document"
	KindDirectory       = "directory"
	KindAttachment      = "attachment"
)

// the documents a directory is shown by: an index replaces its listing, a
// readme is shown with it
const (
	IndexName  = "index.md"
	ReadmeName = "readme.md"
)

// homeTitle names the root, which has no name of its own.
const homeTitle = "Home"

// Crumb is one breadcrumb segment. URL is empty for the last one.
type Crumb struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// Page is one rendered document, without the navigation every page carries
// around it.
type Page struct {
	Path string `json:"path"`

	// DocPath is the file this was rendered from. It differs from Path when a
	// directory is served as its index.md, and it is what history is asked
	// about: a directory has no version of its own.
	DocPath string           `json:"doc_path"`
	Kind    string           `json:"kind"`
	Title   string           `json:"title"`
	HTML    string           `json:"html"`
	TOC     []render.Heading `json:"toc"`
	ShowTOC bool             `json:"show_toc"`
	Rev     string           `json:"rev"`
	ModTime time.Time        `json:"mod_time"`

	Breadcrumbs []Crumb `json:"breadcrumbs"`
	EditURL     string  `json:"edit_url"`
	Missing     bool    `json:"missing"`

	// CanCreate reports whether a write to this path would be allowed at all,
	// which is what the offer to create a missing page hangs on.
	CanCreate bool `json:"can_create"`
}

// Dir is one directory listing.
type Dir struct {
	Path        string     `json:"path"`
	Kind        string     `json:"kind"`
	Title       string     `json:"title"`
	Entries     []DirEntry `json:"entries"`
	ReadmeHTML  string     `json:"readme_html"`
	HasReadme   bool       `json:"has_readme"`
	Breadcrumbs []Crumb    `json:"breadcrumbs"`
}

// DirEntry is one row of a directory listing. Path is what the row's actions
// name, which is not derivable from URL once the extension is dropped.
type DirEntry struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"`
	URL     string    `json:"url"`
	IsDir   bool      `json:"is_dir"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"mod_time"`
}

// NavNode is one node of the sidebar tree. It is not the shape /api/tree
// serves: that one answers API token clients and names only what a file
// operation needs, while this one carries what the sidebar draws. Directories
// come first, then files, both sorted by name case-insensitively, which the
// store already does.
type NavNode struct {
	Name string `json:"name"`
	Path string `json:"path"`
	URL  string `json:"url"`
	// IsDir is a folder, whose URL is its listing
	IsDir bool `json:"is_dir"`
	// Active is on the way to the current page, Current is that page
	Active   bool      `json:"active"`
	Current  bool      `json:"current"`
	Children []NavNode `json:"children"`
}

// NewPage is the document rendered from docPath and presented under navPath.
// The two differ for a directory served as its index.md, which keeps the path
// and the trail of the directory so that the client never has to leave the
// address it was asked to show. Only the edit link names the file.
func NewPage(navPath, docPath string, res render.Result, rev string, modTime time.Time, canCreate bool) Page {
	toc := render.OutlineOf(res.TOC)
	return Page{
		Path:        navPath,
		DocPath:     docPath,
		Kind:        KindDocument,
		Title:       res.Title,
		HTML:        string(res.HTML),
		TOC:         toc,
		ShowTOC:     len(toc) >= render.MinOutline,
		Rev:         rev,
		ModTime:     modTime,
		Breadcrumbs: Breadcrumbs(navPath),
		EditURL:     EditURL(docPath),
		CanCreate:   canCreate,
	}
}

// MissingPage is a markdown path with nothing there, in the shape the client
// needs to offer creating it.
func MissingPage(p string, canCreate bool) Page {
	return Page{
		Path:        p,
		DocPath:     p,
		Kind:        KindMissingDocument,
		Title:       path.Base(p),
		TOC:         []render.Heading{},
		Breadcrumbs: Breadcrumbs(p),
		EditURL:     EditURL(p),
		Missing:     true,
		CanCreate:   canCreate,
	}
}

// NewDir is the listing of a directory holding no index.md. Its README is the
// caller's to render, because rendering it is what may fail.
func NewDir(p string, entries []store.FileInfo) Dir {
	title := homeTitle
	if p != "" {
		title = path.Base(p)
	}
	return Dir{
		Path:        p,
		Kind:        KindDirectory,
		Title:       title,
		Entries:     DirEntries(entries),
		Breadcrumbs: Breadcrumbs(p),
	}
}

// DirEntries turns a store listing into the rows of a directory page.
func DirEntries(entries []store.FileInfo) []DirEntry {
	res := make([]DirEntry, 0, len(entries))
	for _, ent := range entries {
		target := ContentURL(ent.Path)
		if ent.IsDir {
			target = DirURL(ent.Path)
		}
		res = append(res, DirEntry{
			Name:    ent.Name,
			Path:    ent.Path,
			URL:     target,
			IsDir:   ent.IsDir,
			Size:    ent.Size,
			ModTime: ent.ModTime,
		})
	}
	return res
}

// IndexOf finds a directory's own document by name, case-insensitively.
func IndexOf(entries []store.FileInfo, name string) string {
	for _, ent := range entries {
		if !ent.IsDir && strings.EqualFold(ent.Name, name) {
			return ent.Path
		}
	}
	return ""
}

// Nav is the sidebar tree below root, with the branch to current marked.
func Nav(root *store.Node, current string) []NavNode {
	res := make([]NavNode, 0, len(root.Children))
	for _, child := range root.Children {
		if !child.InNavTree() {
			continue
		}
		res = append(res, navNodeOf(child, current))
	}
	return res
}

func navNodeOf(node *store.Node, current string) NavNode {
	res := NavNode{Name: node.Name, Path: node.Path, IsDir: node.IsDir}
	if node.IsDir {
		res.Current = current == node.Path
		res.Active = res.Current || strings.HasPrefix(current, node.Path+"/")
		res.URL = DirURL(node.Path)
		res.Children = Nav(node, current)
		return res
	}
	res.URL = ContentURL(node.Path)
	res.Current = node.Path == current
	res.Children = []NavNode{}
	return res
}

// Breadcrumbs builds the trail for a content path. The last segment carries no
// URL, which is how the client tells the current page from its ancestors.
func Breadcrumbs(p string) []Crumb {
	if p == "" {
		return []Crumb{{Name: homeTitle}}
	}

	segments := strings.Split(p, "/")
	res := make([]Crumb, 0, len(segments)+1)
	res = append(res, Crumb{Name: homeTitle, URL: "/"})

	prefix := ""
	for i, seg := range segments {
		prefix = path.Join(prefix, seg)
		crumb := Crumb{Name: seg}
		if i < len(segments)-1 {
			crumb.URL = DirURL(prefix)
		}
		res = append(res, crumb)
	}
	return res
}

// ContentURL is where a content path is served from: markdown is rendered,
// everything else is handed over untouched.
func ContentURL(p string) string {
	if isMarkdown(p) {
		return "/doc/" + EncodePath(p)
	}
	return "/raw/" + EncodePath(p)
}

// SearchURL is where a search hit leads: the document, plus the query that
// found it, which is what marks the match and scrolls to it on arrival.
func SearchURL(p, query string) string {
	if query == "" {
		return ContentURL(p)
	}
	return ContentURL(p) + "?q=" + url.QueryEscape(query)
}

// DirURL is where a directory is listed.
func DirURL(p string) string {
	if p == "" {
		return "/"
	}
	return "/doc/" + EncodePath(p) + "/"
}

// EditURL is where a document is edited.
func EditURL(p string) string { return "/edit/" + EncodePath(p) }

// EncodePath escapes a content path segment by segment, so the slashes survive
// and everything else is safe in a URL.
func EncodePath(p string) string {
	segments := strings.Split(p, "/")
	for i, seg := range segments {
		segments[i] = url.PathEscape(seg)
	}
	return strings.Join(segments, "/")
}

func isMarkdown(p string) bool { return strings.EqualFold(path.Ext(p), ".md") }
