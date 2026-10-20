// Package view builds what a reader is shown of a space: the answers the app's
// routes send, and that a site writes into its pages, from one set of builders
// so the two can never describe a note differently.
//
// Every URL here is router-relative, which is what the JSON hands the client:
// React Router prepends the space's basename itself, so a prefix written in
// here would produce /s/notes/s/notes/... . The one exception is File.RawURL,
// which names a route the browser fetches directly; the reading side mounts it.
package view

import (
	"net/url"
	"path"
	"strconv"
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
	KindFile            = "file"
)

// the ways a file that is not a note is shown on its page
const (
	FileImage = "image"
	FileText  = "text"
	FileOther = "other"
)

// IndexName is a folder's own note, its folder page: a row of its list like any
// other, which Home opens at the root. The name is matched in any case.
const IndexName = "index.md"

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
	Path    string           `json:"path"`
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
	// FolderPage is the folder's own note, its index.md
	FolderPage bool `json:"folder_page,omitempty"`
	// Items is how many entries a folder shows one level down
	Items int `json:"items,omitempty"`
	// EditURL is where the file is edited, left out of one the editor cannot open
	EditURL string `json:"edit_url,omitempty"`
}

// File is a file of the space that is not a note, on a page of its own: a
// picture previewed from /raw/, a text file as numbered lines, anything else
// as its download. Language, Lines and HTML are only a text file's.
type File struct {
	Path        string    `json:"path"`
	Kind        string    `json:"kind"`
	Name        string    `json:"name"`
	Type        string    `json:"type"`
	Size        int64     `json:"size"`
	ModTime     time.Time `json:"mod_time"`
	Breadcrumbs []Crumb   `json:"breadcrumbs"`
	RawURL      string    `json:"raw_url"`
	Rev         string    `json:"rev,omitempty"`
	EditURL     string    `json:"edit_url,omitempty"`
	Language    string    `json:"language,omitempty"`
	Lines       int       `json:"lines,omitempty"`
	HTML        string    `json:"html,omitempty"`
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
	Active  bool `json:"active"`
	Current bool `json:"current"`
	// FolderPage is the folder's own note, its index.md
	FolderPage bool      `json:"folder_page,omitempty"`
	Children   []NavNode `json:"children"`
}

// NewPage is the document rendered from p. A note is shown under its own
// address only: a folder is always its list.
func NewPage(p string, res render.Result, rev string, modTime time.Time, canCreate bool) Page {
	toc := render.OutlineOf(res.TOC)
	return Page{
		Path:        p,
		Kind:        KindDocument,
		Title:       res.Title,
		HTML:        string(res.HTML),
		TOC:         toc,
		ShowTOC:     len(toc) >= render.MinOutline,
		Rev:         rev,
		ModTime:     modTime,
		Breadcrumbs: Breadcrumbs(p),
		EditURL:     EditURL(p),
		CanCreate:   canCreate,
	}
}

// MissingPage is a markdown path with nothing there, in the shape the client
// needs to offer creating it.
func MissingPage(p string, canCreate bool) Page {
	return Page{
		Path:        p,
		Kind:        KindMissingDocument,
		Title:       path.Base(p),
		TOC:         []render.Heading{},
		Breadcrumbs: Breadcrumbs(p),
		EditURL:     EditURL(p),
		Missing:     true,
		CanCreate:   canCreate,
	}
}

// NewFile is the page of a file that is not a note, shown as fileType. What a
// text file shows is the caller's to add, because reading it is what may fail.
func NewFile(fi store.FileInfo, fileType string) File {
	return File{
		Path:        fi.Path,
		Kind:        KindFile,
		Name:        fi.Name,
		Type:        fileType,
		Size:        fi.Size,
		ModTime:     fi.ModTime,
		Breadcrumbs: Breadcrumbs(fi.Path),
		RawURL:      "/raw/" + EncodePath(fi.Path),
	}
}

// NewDir is the listing of a directory, which is what a folder is always shown
// as. Its index.md is one of the rows, tagged as the folder page.
func NewDir(p string, entries []store.FileInfo, items Counter, editable Editable) Dir {
	title := homeTitle
	if p != "" {
		title = path.Base(p)
	}
	return Dir{
		Path:        p,
		Kind:        KindDirectory,
		Title:       title,
		Entries:     DirEntries(entries, items, editable),
		Breadcrumbs: Breadcrumbs(p),
	}
}

// Counter answers how many entries a folder shows, for the line under its name
// on a phone.
type Counter func(dir string) int

// Editable answers whether the editor can open a file of a listing, which only
// the server can say.
type Editable func(fi store.FileInfo) bool

// NotEditable is a listing the reader can only read, a site's.
func NotEditable(store.FileInfo) bool { return false }

// ItemsIn counts what a listing of the folder holds; a folder that cannot be
// listed holds nothing worth counting.
func ItemsIn(list func(dir string) ([]store.FileInfo, error)) Counter {
	return func(dir string) int {
		entries, err := list(dir)
		if err != nil {
			return 0
		}
		return len(entries)
	}
}

// DirEntries turns a store listing into the rows of a directory page.
func DirEntries(entries []store.FileInfo, items Counter, editable Editable) []DirEntry {
	index := IndexOf(entries)
	res := make([]DirEntry, 0, len(entries))
	for _, ent := range entries {
		target := ContentURL(ent.Path)
		count := 0
		edit := ""
		switch {
		case ent.IsDir:
			target = DirURL(ent.Path)
			count = items(ent.Path)
		case editable(ent):
			edit = EditURL(ent.Path)
		}
		res = append(res, DirEntry{
			Name:       ent.Name,
			Path:       ent.Path,
			URL:        target,
			IsDir:      ent.IsDir,
			Size:       ent.Size,
			ModTime:    ent.ModTime,
			FolderPage: index != "" && ent.Path == index,
			Items:      count,
			EditURL:    edit,
		})
	}
	return res
}

// IndexOf finds a directory's own note, its index.md in any case. A folder
// holding more than one case of the name has none: which one it meant cannot
// be told, and a site would write both to the same file.
func IndexOf(entries []store.FileInfo) string {
	res := ""
	for _, ent := range entries {
		if ent.IsDir || !strings.EqualFold(ent.Name, IndexName) {
			continue
		}
		if res != "" {
			return ""
		}
		res = ent.Path
	}
	return res
}

// Nav is the sidebar tree below root, with the branch to current marked.
func Nav(root *store.Node, current string) []NavNode {
	infos := make([]store.FileInfo, 0, len(root.Children))
	for _, child := range root.Children {
		infos = append(infos, child.FileInfo)
	}
	index := IndexOf(infos)
	res := make([]NavNode, 0, len(root.Children))
	for _, child := range root.Children {
		if !child.InNavTree() {
			continue
		}
		node := navNodeOf(child, current)
		node.FolderPage = index != "" && child.Path == index
		res = append(res, node)
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

// ContentURL is the page of a file: a note rendered, any other file shown the
// way its page shows it.
func ContentURL(p string) string {
	return "/doc/" + EncodePath(p)
}

// SearchURL is where a search hit leads: the document, plus the query that
// found it, which is what marks the match and scrolls to it on arrival.
func SearchURL(p, query string) string {
	if query == "" {
		return ContentURL(p)
	}
	return ContentURL(p) + "?q=" + url.QueryEscape(query)
}

// Find is what a note opens with in its find bar: the text, and the toggles it
// is matched with.
type Find struct {
	Text              string
	Case, Word, Regex bool
}

// FindURL opens a note with its find bar filled in, and at a line of its
// source when line is not 0: what a search result leads to.
func FindURL(p string, f Find, line int) string {
	q := url.Values{}
	q.Set("q", f.Text)
	for name, on := range map[string]bool{"case": f.Case, "word": f.Word, "regex": f.Regex} {
		if on {
			q.Set(name, "1")
		}
	}
	if line > 0 {
		q.Set("line", strconv.Itoa(line))
	}
	return ContentURL(p) + "?" + q.Encode()
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
