package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"io/fs"
	"maps"
	"os"
	"path"
	"slices"
	"strings"

	"github.com/aleksey925/scrawl/page"
	"github.com/aleksey925/scrawl/plantuml"
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/server"
	"github.com/aleksey925/scrawl/store"
	"github.com/aleksey925/scrawl/view"
)

const (
	siteAssets    = "scrawl"
	sitePage      = ".html"
	siteFolder    = "index.html"
	siteIndexPage = "index.md.html"
	siteNotFound  = "404.html"
	siteTreeFile  = "tree.js"
	siteChroma    = "chroma.css"
	siteFavicon   = "favicon.svg"
	siteTitle     = "Notes"
	siteDirMode   = fs.FileMode(0o755)
	siteFileMode  = fs.FileMode(0o644)
)

var activeExtensions = []string{".htm", ".html", ".js", ".mjs", ".svg", ".xht", ".xhtml", ".xml", ".xsl"}

type siteOptions struct {
	Output  string   `short:"o" long:"output" required:"yes" description:"directory to write the site into, created when missing and refused when not empty"`
	Exclude []string `long:"exclude" description:"extra ignore globs, the ones serve takes"`
	Args    struct {
		Dir string `positional-arg-name:"DIR" required:"yes" description:"directory of notes"`
	} `positional-args:"yes" required:"yes"`
}

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
		renderer: render.New(render.Options{
			Relative: true, PageExt: sitePage, FolderPage: siteFolder, IndexPage: siteIndexPage,
		}),
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

type sitePlan struct {
	root     *store.Node
	folders  []string
	notes    []string
	files    []string
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

	var walk func(node *store.Node) error
	walk = func(node *store.Node) error {
		if node.IsDir {
			plan.folders = append(plan.folders, node.Path)
			if err := claim(folderPageOf(node.Path), folderName(node.Path)); err != nil {
				return err
			}
			for _, child := range node.Children {
				if err := walk(child); err != nil {
					return err
				}
			}
			return nil
		}
		switch {
		case isMarkdown(node.Path):
			plan.notes = append(plan.notes, node.Path)
			return claim(notePageOf(node.Path), node.Path)
		default:
			plan.files = append(plan.files, node.Path)
			return claim(node.Path, node.Path)
		}
	}
	if err := walk(root); err != nil {
		return sitePlan{}, err
	}
	if err := checkSiteDirs(written); err != nil {
		return sitePlan{}, err
	}
	plan.notFound = !slices.ContainsFunc(slices.Collect(maps.Keys(written)), func(name string) bool {
		return name == siteNotFound || strings.HasPrefix(name, siteNotFound+"/")
	})
	return plan, nil
}

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
	st                      *store.Store
	dst                     *os.Root
	renderer                *render.Renderer
	mermaid, plantUML, math bool
	plantUMLLibraries       []string
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
	if b.mermaid {
		assets[page.MermaidFile] = page.Mermaid()
	}
	if b.plantUML {
		assets[page.PlantUMLFile] = page.PlantUML()
		if err := b.addLibraries(assets); err != nil {
			return err
		}
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

func (b *siteBuilder) addLibraries(assets map[string]string) error {
	libs, err := plantuml.LibraryCode(b.plantUMLLibraries)
	if err != nil {
		return fmt.Errorf("plantuml libraries: %w", err)
	}
	for name, code := range libs {
		assets[path.Join(plantuml.LibraryDir, name)] = string(code)
	}
	return nil
}

func (b *siteBuilder) render(notePath string) (render.Result, []byte, store.FileInfo, error) {
	src, fi, err := b.st.Read(notePath)
	if err != nil {
		return render.Result{}, nil, store.FileInfo{}, fmt.Errorf("read %s: %w", notePath, err)
	}
	res, err := b.renderer.Render(src, notePath)
	if err != nil {
		return render.Result{}, nil, store.FileInfo{}, fmt.Errorf("render %s: %w", notePath, err)
	}
	b.mermaid = b.mermaid || res.Mermaid
	b.plantUML = b.plantUML || res.PlantUML
	if res.PlantUML {
		b.plantUMLLibraries = append(b.plantUMLLibraries, plantuml.Libraries(plantUMLText(src, res.HTML))...)
	}
	b.math = b.math || res.Math
	return res, src, fi, nil
}

func plantUMLText(src []byte, fragment template.HTML) []byte {
	text := slices.Clone(src)
	for _, block := range render.DiagramBlocks(string(fragment), render.PlantUMLClass) {
		text = append(append(text, '\n'), block.Text()...)
	}
	return text
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
		Answer: view.NewPage(notePath, res, store.Rev(src), fi.ModTime, false),
	})
}

func (b *siteBuilder) writeFolder(dir string) error {
	entries, err := b.st.List(dir)
	if err != nil {
		return fmt.Errorf("list %s: %w", folderName(dir), err)
	}
	name := folderPageOf(dir)
	up := siteUp(name)
	sp := page.SitePage{Title: folderTitle(dir), Crumbs: siteCrumbs(dir, up), Entries: siteEntries(entries, dir)}
	answer := view.NewDir(dir, entries, b.st.Count, view.NotEditable)
	return b.writePage(name, sp, sitePageData{Route: view.DirURL(dir), Answer: answer})
}

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

type siteData struct {
	Title string         `json:"title"`
	Tree  []view.NavNode `json:"tree"`
}

func (b *siteBuilder) writeTree(root *store.Node) error {
	title := siteTitle
	if index := view.IndexOfNode(root); index != "" {
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
	return b.write(path.Join(siteAssets, siteTreeFile), append(append([]byte("self.scrawlSite = "), raw...), ";\n"...))
}

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

func siteEntries(entries []store.FileInfo, dir string) []page.Link {
	res := make([]page.Link, 0, len(entries))
	for _, ent := range entries {
		target := ent.Path
		switch {
		case ent.IsDir:
			target = folderPageOf(ent.Path)
		case isMarkdown(ent.Path):
			target = notePageOf(ent.Path)
		}
		rel := strings.TrimPrefix(target, folderPrefix(dir))
		res = append(res, page.Link{Href: "./" + view.EncodePath(rel), Title: ent.Name})
	}
	return res
}

func warnActive(out io.Writer, files []string) error {
	active := activeFiles(files)
	if len(active) == 0 {
		return nil
	}
	return writeText(out, fmt.Sprintf(
		"warning: copied as they are, these files run their scripts when opened from the site: %s\n",
		strings.Join(active, ", ")))
}

func activeFiles(files []string) []string {
	res := []string{}
	for _, name := range files {
		if slices.Contains(activeExtensions, strings.ToLower(path.Ext(name))) {
			res = append(res, name)
		}
	}
	return res
}

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

func isFolderIndex(notePath string) bool {
	return strings.EqualFold(path.Base(notePath), view.IndexName)
}

func siteUp(name string) string {
	if depth := strings.Count(name, "/"); depth > 0 {
		return strings.Repeat("../", depth)
	}
	return "./"
}

func notePageOf(notePath string) string {
	if isFolderIndex(notePath) {
		return folderPrefix(folderOf(notePath)) + siteIndexPage
	}
	return strings.TrimSuffix(notePath, path.Ext(notePath)) + sitePage
}

func folderPageOf(dir string) string {
	return folderPrefix(dir) + siteFolder
}

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
