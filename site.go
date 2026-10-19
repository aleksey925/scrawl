package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"maps"
	"os"
	"path"
	"slices"
	"strings"

	"github.com/aleksey925/scrawl/page"
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/server"
	"github.com/aleksey925/scrawl/store"
	"github.com/aleksey925/scrawl/view"
)

const (
	// siteAssets is where the scripts and the stylesheets every page links to
	// are written. Not "_scrawl": GitHub Pages runs Jekyll, which drops it.
	siteAssets   = "scrawl"
	sitePage     = ".html"
	siteFolder   = "index.html"
	siteNotFound = "404.html"
	siteTreeFile = "tree.js"
	siteChroma   = "chroma.css"
	siteFavicon  = "favicon.svg"
	siteTitle    = "Notes"
	siteDirMode  = fs.FileMode(0o755)
	siteFileMode = fs.FileMode(0o644)
)

// activeExtensions are the files a browser runs a script from when one is
// opened directly. The app hands them out as downloads; a site copies them.
var activeExtensions = []string{".htm", ".html", ".js", ".mjs", ".svg", ".xht", ".xhtml", ".xml", ".xsl"}

type siteOptions struct {
	Output  string   `short:"o" long:"output" required:"yes" description:"directory to write the site into, created when missing and refused when not empty"`
	Exclude []string `long:"exclude" description:"extra ignore globs, the ones serve takes"`
	Args    struct {
		Dir string `positional-arg-name:"DIR" required:"yes" description:"directory of notes"`
	} `positional-args:"yes" required:"yes"`
}

// runSite writes the app's reader as a static site: a page for every note and
// every folder, each carrying the answer the server would give for it, and a
// copy of every other file the app would serve, so the links keep working.
func runSite(opts *siteOptions, out io.Writer) error {
	st, err := store.New(store.Config{Root: opts.Args.Dir, Exclude: opts.Exclude, ReadOnly: true})
	if err != nil {
		return fmt.Errorf("open notes: %w", err)
	}
	defer st.Close()

	plan, err := planSite(st)
	if err != nil {
		return err
	}

	dst, err := openSiteDir(opts.Output)
	if err != nil {
		return err
	}
	defer dst.Close()

	b := siteBuilder{
		st: st, dst: dst,
		renderer: render.New(render.Options{Relative: true, PageExt: sitePage, FolderPage: siteFolder}),
	}
	if writeErr := b.writeSite(plan); writeErr != nil {
		return writeErr
	}
	if warnErr := warnActive(out, plan.files); warnErr != nil {
		return warnErr
	}
	pages := len(plan.notes) + len(plan.folders)
	return writeText(out, fmt.Sprintf("%d pages and %d other files written to %s\n", pages, len(plan.files), opts.Output))
}

// sitePlan is what a site is made of, read from the notes before anything is
// written, so a name two of them would share is refused with nothing on disk.
type sitePlan struct {
	root *store.Node
	// folders are every folder, the root first, each written as its index page
	folders []string
	// notes are the notes with a page of their own, which a folder's index
	// does not have: it is the folder's page
	notes []string
	// files are copied as they are
	files []string
	// notFound is whether 404.html is the site's to write
	notFound bool
}

func planSite(st *store.Store) (sitePlan, error) {
	root, treeErr := st.Tree()
	if treeErr != nil {
		return sitePlan{}, fmt.Errorf("list notes: %w", treeErr)
	}
	plan := sitePlan{root: root}
	written := map[string]string{}
	claim := func(name, owner string) error {
		if top, _, _ := strings.Cut(name, "/"); top == siteAssets {
			return fmt.Errorf("%s/ is where the site keeps its scripts, and the notes hold %s", siteAssets, owner)
		}
		if other, ok := written[name]; ok {
			return fmt.Errorf("%s and %s would both be written to %s", other, owner, name)
		}
		written[name] = owner
		return nil
	}

	var walk func(node *store.Node, index string) error
	walk = func(node *store.Node, index string) error {
		if node.IsDir {
			plan.folders = append(plan.folders, node.Path)
			if err := claim(folderPageOf(node.Path), folderName(node.Path)); err != nil {
				return err
			}
			own := indexOfFolder(node)
			for _, child := range node.Children {
				if err := walk(child, own); err != nil {
					return err
				}
			}
			return nil
		}
		switch {
		case node.Path == index:
			return nil
		case isMarkdown(node.Path) && isFolderIndex(node.Path):
			return claim(folderPageOf(folderOf(node.Path)), node.Path)
		case isMarkdown(node.Path):
			plan.notes = append(plan.notes, node.Path)
			return claim(notePageOf(node.Path), node.Path)
		default:
			plan.files = append(plan.files, node.Path)
			return claim(node.Path, node.Path)
		}
	}
	if err := walk(root, ""); err != nil {
		return sitePlan{}, err
	}
	if err := checkSiteDirs(written); err != nil {
		return sitePlan{}, err
	}
	// the notes may hold a page for a missing address of their own, or a folder
	// where it would go
	plan.notFound = !slices.ContainsFunc(slices.Collect(maps.Keys(written)), func(name string) bool {
		return name == siteNotFound || strings.HasPrefix(name, siteNotFound+"/")
	})
	return plan, nil
}

// checkSiteDirs refuses a file written where a folder of the site has to be,
// as a.md and a folder named a.html would both want.
func checkSiteDirs(written map[string]string) error {
	names := make([]string, 0, len(written))
	for name := range written {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		for dir := path.Dir(name); dir != "."; dir = path.Dir(dir) {
			if other, ok := written[dir]; ok {
				return fmt.Errorf("%s is written to %s, where %s needs a folder", other, dir, written[name])
			}
		}
	}
	return nil
}

type siteBuilder struct {
	st       *store.Store
	dst      *os.Root
	renderer *render.Renderer
	// diagrams and math are whether a page written so far needs the renderer
	diagrams, math bool
}

func (b *siteBuilder) writeSite(plan sitePlan) error {
	for _, dir := range plan.folders {
		if err := b.writeFolder(dir); err != nil {
			return err
		}
	}
	for _, note := range plan.notes {
		if err := b.writeNote(note); err != nil {
			return err
		}
	}
	for _, file := range plan.files {
		if err := b.copyFile(file); err != nil {
			return err
		}
	}
	if err := b.writeTree(plan.root); err != nil {
		return err
	}
	if plan.notFound {
		var buf bytes.Buffer
		if err := page.WriteNotFound(&buf); err != nil {
			return err
		}
		if err := b.write(siteNotFound, buf.Bytes()); err != nil {
			return err
		}
	}
	return b.writeAssets()
}

func (b *siteBuilder) writeAssets() error {
	assets := page.SiteAssets()
	assets[siteChroma] = string(render.ChromaCSS())
	assets[siteFavicon] = string(server.Favicon())
	if b.diagrams {
		assets[page.DiagramsFile] = page.Diagrams()
	}
	if b.math {
		maps.Copy(assets, page.Math())
	}
	for name, content := range assets {
		if err := b.write(path.Join(siteAssets, name), []byte(content)); err != nil {
			return err
		}
	}
	return nil
}

// render renders one note and notes what renderers the site has to carry.
func (b *siteBuilder) render(notePath string) (render.Result, []byte, store.FileInfo, error) {
	src, fi, err := b.st.Read(notePath)
	if err != nil {
		return render.Result{}, nil, store.FileInfo{}, fmt.Errorf("read %s: %w", notePath, err)
	}
	res, err := b.renderer.Render(src, notePath)
	if err != nil {
		return render.Result{}, nil, store.FileInfo{}, fmt.Errorf("render %s: %w", notePath, err)
	}
	b.diagrams = b.diagrams || res.Diagrams
	b.math = b.math || res.Math
	return res, src, fi, nil
}

func (b *siteBuilder) writeNote(notePath string) error {
	res, src, fi, err := b.render(notePath)
	if err != nil {
		return err
	}
	name := notePageOf(notePath)
	return b.writePage(name, page.SitePage{
		Title:  res.Title,
		Crumbs: siteCrumbs(notePath, siteUp(name)),
		HTML:   string(res.HTML),
	}, sitePageData{
		Route:  view.ContentURL(notePath),
		Answer: view.NewPage(notePath, notePath, res, store.Rev(src), fi.ModTime, false),
	})
}

// writeFolder writes the page of a folder the way /api/dir/ answers for it: its
// index.md under the folder's own path, or the listing with its readme.
func (b *siteBuilder) writeFolder(dir string) error {
	entries, err := b.st.List(dir)
	if err != nil {
		return fmt.Errorf("list %s: %w", folderName(dir), err)
	}
	name := folderPageOf(dir)
	up := siteUp(name)
	sp := page.SitePage{Title: folderTitle(dir), Crumbs: siteCrumbs(dir, up), Entries: siteEntries(entries, dir)}
	data := sitePageData{Route: view.DirURL(dir)}

	if index := view.IndexOf(entries, view.IndexName); index != "" {
		res, src, fi, renderErr := b.render(index)
		if renderErr != nil {
			return renderErr
		}
		sp.Title, sp.HTML = res.Title, string(res.HTML)
		data.Answer = view.NewPage(dir, index, res, store.Rev(src), fi.ModTime, false)
		return b.writePage(name, sp, data)
	}

	listing := view.NewDir(dir, entries)
	if readme := view.IndexOf(entries, view.ReadmeName); readme != "" {
		res, _, _, renderErr := b.render(readme)
		if renderErr != nil {
			return renderErr
		}
		listing.ReadmeHTML, listing.HasReadme = string(res.HTML), true
		sp.HTML = listing.ReadmeHTML
	}
	data.Answer = listing
	return b.writePage(name, sp, data)
}

// sitePageData is the JSON a page carries: the route of the app it stands for,
// the way back to the root, and the answer the server gives for that route.
// web/src/site/data.ts reads it.
type sitePageData struct {
	Route  string `json:"route"`
	Root   string `json:"root"`
	Answer any    `json:"answer"`
}

func (b *siteBuilder) writePage(name string, sp page.SitePage, data sitePageData) error {
	up := siteUp(name)
	data.Root = up
	raw, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("write %s: %w", name, err)
	}
	sp.Data, sp.Assets = raw, up+siteAssets
	var buf bytes.Buffer
	if err = page.WriteSitePage(&buf, sp); err != nil {
		return fmt.Errorf("write %s: %w", name, err)
	}
	return b.write(name, buf.Bytes())
}

// siteData is scrawl/tree.js, the one copy of the tree every page shares.
// web/src/site/data.ts reads it.
type siteData struct {
	Title string         `json:"title"`
	Tree  []view.NavNode `json:"tree"`
}

func (b *siteBuilder) writeTree(root *store.Node) error {
	title := siteTitle
	if index := indexOfFolder(root); index != "" {
		res, _, _, err := b.render(index)
		if err != nil {
			return err
		}
		title = res.Title
	}
	raw, err := json.Marshal(siteData{Title: title, Tree: withNotes(view.Nav(root, ""))})
	if err != nil {
		return fmt.Errorf("write %s: %w", siteTreeFile, err)
	}
	// a page opened from disk can fetch nothing, so the tree is a script that
	// hands itself over
	return b.write(path.Join(siteAssets, siteTreeFile), append(append([]byte("self.scrawlSite = "), raw...), ";\n"...))
}

// withNotes is the tree less the folders that hold no note: in the app a folder
// is where a note is made, and a site makes none, so an empty folder or one of
// pictures would only stand in the way. It is still a page of the site.
func withNotes(nodes []view.NavNode) []view.NavNode {
	res := []view.NavNode{}
	for _, node := range nodes {
		if node.IsDir {
			if node.Children = withNotes(node.Children); len(node.Children) == 0 {
				continue
			}
		}
		res = append(res, node)
	}
	return res
}

func (b *siteBuilder) copyFile(filePath string) error {
	src, _, err := b.st.Open(filePath)
	if err != nil {
		return fmt.Errorf("read %s: %w", filePath, err)
	}
	defer src.Close()

	if err = b.dst.MkdirAll(path.Dir(filePath), siteDirMode); err != nil {
		return fmt.Errorf("write %s: %w", filePath, err)
	}
	f, err := b.dst.OpenFile(filePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, siteFileMode)
	if err != nil {
		return fmt.Errorf("write %s: %w", filePath, err)
	}
	if _, err = io.Copy(f, src); err != nil {
		_ = f.Close()
		return fmt.Errorf("write %s: %w", filePath, err)
	}
	if err = f.Close(); err != nil {
		return fmt.Errorf("write %s: %w", filePath, err)
	}
	return nil
}

func (b *siteBuilder) write(name string, data []byte) error {
	if err := b.dst.MkdirAll(path.Dir(name), siteDirMode); err != nil {
		return fmt.Errorf("write %s: %w", name, err)
	}
	if err := b.dst.WriteFile(name, data, siteFileMode); err != nil {
		return fmt.Errorf("write %s: %w", name, err)
	}
	return nil
}

// siteCrumbs is the path to a note or a folder as links of the page at up, for
// a reader without javascript.
func siteCrumbs(p, up string) []page.Link {
	crumbs := view.Breadcrumbs(p)
	res := make([]page.Link, 0, len(crumbs))
	prefix := ""
	for i, crumb := range crumbs {
		if i > 0 {
			prefix = path.Join(prefix, crumb.Name)
		}
		link := page.Link{Title: crumb.Name}
		if crumb.URL != "" {
			link.Href = up + view.EncodePath(folderPageOf(prefix))
		}
		res = append(res, link)
	}
	return res
}

// siteEntries is what a folder holds as links of its own page.
func siteEntries(entries []store.FileInfo, dir string) []page.Link {
	res := make([]page.Link, 0, len(entries))
	for _, ent := range entries {
		target := ent.Path
		switch {
		case ent.IsDir:
			target = folderPageOf(ent.Path)
		case isMarkdown(ent.Path) && isFolderIndex(ent.Path):
			target = folderPageOf(dir)
		case isMarkdown(ent.Path):
			target = notePageOf(ent.Path)
		}
		rel := strings.TrimPrefix(target, folderPrefix(dir))
		res = append(res, page.Link{Href: "./" + view.EncodePath(rel), Title: ent.Name})
	}
	return res
}

// warnActive names the copied files a browser would run a script from.
func warnActive(out io.Writer, files []string) error {
	active := activeFiles(files)
	if len(active) == 0 {
		return nil
	}
	return writeText(out, fmt.Sprintf(
		"warning: copied as they are, these files run their scripts when opened from the site: %s\n",
		strings.Join(active, ", ")))
}

// activeFiles are the copied files a browser would run a script from.
func activeFiles(files []string) []string {
	res := []string{}
	for _, name := range files {
		if slices.Contains(activeExtensions, strings.ToLower(path.Ext(name))) {
			res = append(res, name)
		}
	}
	return res
}

// openSiteDir creates the directory of the site, or takes an empty one. A
// directory with something in it is refused rather than written over.
func openSiteDir(dir string) (*os.Root, error) {
	if err := os.MkdirAll(dir, siteDirMode); err != nil {
		return nil, fmt.Errorf("create %s: %w", dir, err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", dir, err)
	}
	if len(entries) > 0 {
		return nil, fmt.Errorf("%s is not empty", dir)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", dir, err)
	}
	return root, nil
}

// indexOfFolder is the note a folder of the tree is shown as, "" for none: the
// one /api/dir/ picks.
func indexOfFolder(node *store.Node) string {
	infos := make([]store.FileInfo, 0, len(node.Children))
	for _, child := range node.Children {
		infos = append(infos, child.FileInfo)
	}
	return view.IndexOf(infos, view.IndexName)
}

func isFolderIndex(notePath string) bool {
	return strings.EqualFold(path.Base(notePath), view.IndexName)
}

// siteUp leads from a page of the site back to its root. At the root it is
// "./", so a note named "a:b.md" is not read as the scheme "a:".
func siteUp(name string) string {
	if depth := strings.Count(name, "/"); depth > 0 {
		return strings.Repeat("../", depth)
	}
	return "./"
}

// notePageOf and folderPageOf are the files of a site a note and a folder are
// written to; web/src/site/files.ts maps a route of the app the same way.
func notePageOf(notePath string) string {
	return strings.TrimSuffix(notePath, path.Ext(notePath)) + sitePage
}

func folderPageOf(dir string) string {
	return folderPrefix(dir) + siteFolder
}

// folderOf is the folder a file is in, "" for the root
func folderOf(p string) string {
	if dir := path.Dir(p); dir != "." {
		return dir
	}
	return ""
}

func folderPrefix(dir string) string {
	if dir == "" {
		return ""
	}
	return dir + "/"
}

func folderName(dir string) string {
	if dir == "" {
		return "the root"
	}
	return dir + "/"
}

func folderTitle(dir string) string {
	if dir == "" {
		return "Home"
	}
	return path.Base(dir)
}
