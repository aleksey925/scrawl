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

const (
	KindDocument        = "document"
	KindMissingDocument = "missing-document"
	KindDirectory       = "directory"
	KindFile            = "file"
)

const (
	FileImage = "image"
	FileText  = "text"
	FileOther = "other"
)

const IndexName = "index.md"

const homeTitle = "Home"

type Crumb struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

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

	CanCreate bool `json:"can_create"`
}

type Dir struct {
	Path        string     `json:"path"`
	Kind        string     `json:"kind"`
	Title       string     `json:"title"`
	Entries     []DirEntry `json:"entries"`
	Breadcrumbs []Crumb    `json:"breadcrumbs"`
}

type DirEntry struct {
	Name       string    `json:"name"`
	Path       string    `json:"path"`
	URL        string    `json:"url"`
	IsDir      bool      `json:"is_dir"`
	Size       int64     `json:"size"`
	ModTime    time.Time `json:"mod_time"`
	FolderPage bool      `json:"folder_page,omitempty"`
	Items      int       `json:"items,omitempty"`
	EditURL    string    `json:"edit_url,omitempty"`
}

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

type NavNode struct {
	Name       string    `json:"name"`
	Path       string    `json:"path"`
	URL        string    `json:"url"`
	IsDir      bool      `json:"is_dir"`
	Active     bool      `json:"active"`
	Current    bool      `json:"current"`
	FolderPage bool      `json:"folder_page,omitempty"`
	Children   []NavNode `json:"children"`
}

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

func NewDir(p string, entries []store.FileInfo, count Count, editable Editable) Dir {
	title := homeTitle
	if p != "" {
		title = path.Base(p)
	}
	return Dir{
		Path:        p,
		Kind:        KindDirectory,
		Title:       title,
		Entries:     DirEntries(entries, count, editable),
		Breadcrumbs: Breadcrumbs(p),
	}
}

type Editable func(store.FileInfo) bool

func NotEditable(store.FileInfo) bool { return false }

type Count func(dir string) (int, error)

func DirEntries(entries []store.FileInfo, count Count, editable Editable) []DirEntry {
	index := IndexOf(entries)
	res := make([]DirEntry, 0, len(entries))
	for _, ent := range entries {
		target := ContentURL(ent.Path)
		items := 0
		edit := ""
		switch {
		case ent.IsDir:
			target = DirURL(ent.Path)
			if n, err := count(ent.Path); err == nil {
				items = n
			}
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
			Items:      items,
			EditURL:    edit,
		})
	}
	return res
}

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

func IndexOfNode(node *store.Node) string {
	infos := make([]store.FileInfo, 0, len(node.Children))
	for _, child := range node.Children {
		infos = append(infos, child.FileInfo)
	}
	return IndexOf(infos)
}

func Nav(root *store.Node, current string) []NavNode {
	index := IndexOfNode(root)
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

func ContentURL(p string) string {
	return "/doc/" + EncodePath(p)
}

func SearchURL(p, query string) string {
	if query == "" {
		return ContentURL(p)
	}
	return ContentURL(p) + "?q=" + url.QueryEscape(query)
}

type Find struct {
	Text              string
	Case, Word, Regex bool
}

func FindURL(p string, f Find, line int) string {
	q := url.Values{}
	if f.Text != "" {
		q.Set("q", f.Text)
		for name, on := range map[string]bool{"case": f.Case, "word": f.Word, "regex": f.Regex} {
			if on {
				q.Set(name, "1")
			}
		}
	}
	if line > 0 {
		q.Set("line", strconv.Itoa(line))
	}
	if len(q) == 0 {
		return ContentURL(p)
	}
	return ContentURL(p) + "?" + q.Encode()
}

func DirURL(p string) string {
	if p == "" {
		return "/"
	}
	return "/doc/" + EncodePath(p) + "/"
}

func EditURL(p string) string { return "/edit/" + EncodePath(p) }

func EncodePath(p string) string {
	segments := strings.Split(p, "/")
	for i, seg := range segments {
		segments[i] = url.PathEscape(seg)
	}
	return strings.Join(segments, "/")
}
