package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path"
	"strings"

	"github.com/aleksey925/scrawl/page"
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/store"
)

const (
	// siteAssets is where the stylesheet and the script every page links to
	// are written. Not "_scrawl": GitHub Pages runs Jekyll, which drops it.
	siteAssets   = "scrawl"
	siteHome     = "index.md"
	sitePage     = ".html"
	siteDirMode  = fs.FileMode(0o755)
	siteFileMode = fs.FileMode(0o644)
)

type siteOptions struct {
	Output  string   `short:"o" long:"output" required:"yes" description:"directory to write the site into, created when missing and refused when not empty"`
	Math    bool     `long:"math" description:"typeset formulas with KaTeX, one shared copy of some 600KB"`
	Exclude []string `long:"exclude" description:"extra ignore globs, the ones serve takes"`
	Args    struct {
		Dir string `positional-arg-name:"DIR" required:"yes" description:"directory of notes"`
	} `positional-args:"yes" required:"yes"`
}

// runSite writes every note the app would show as a page, and copies every
// other file it would serve, so the links between them keep working.
func runSite(opts *siteOptions, out io.Writer) error {
	st, err := store.New(store.Config{Root: opts.Args.Dir, Exclude: opts.Exclude, ReadOnly: true})
	if err != nil {
		return fmt.Errorf("open notes: %w", err)
	}
	defer st.Close()

	files, err := siteFiles(st)
	if err != nil {
		return err
	}

	dst, err := openSiteDir(opts.Output)
	if err != nil {
		return err
	}
	defer dst.Close()

	b := siteBuilder{
		st: st, dst: dst, math: opts.Math,
		renderer: render.New(render.Options{Relative: true, PageExt: sitePage}),
	}
	if b.home, err = b.homeTitle(); err != nil {
		return err
	}
	if b.tree, err = siteTree(st); err != nil {
		return err
	}

	pages := 0
	for _, entry := range files {
		if isMarkdown(entry.Path) {
			err = b.writePage(entry.Path)
			pages++
		} else {
			err = b.copyFile(entry.Path)
		}
		if err != nil {
			return err
		}
	}
	assets := page.Assets(page.Options{Math: opts.Math})
	if b.diagrams {
		assets[page.DiagramsFile] = page.Diagrams()
	}
	for name, content := range assets {
		if err := b.write(path.Join(siteAssets, name), []byte(content)); err != nil {
			return err
		}
	}
	return writeText(out, fmt.Sprintf("%d pages and %d other files written to %s\n", pages, len(files)-pages, opts.Output))
}

type siteBuilder struct {
	st       *store.Store
	dst      *os.Root
	renderer *render.Renderer
	math     bool
	// home is the title of the front page, "" when the notes have none
	home string
	tree []siteNode
	// diagrams is whether a page written so far has a diagram to draw
	diagrams bool
}

func (b *siteBuilder) homeTitle() (string, error) {
	src, _, err := b.st.Read(siteHome)
	if errors.Is(err, store.ErrNotFound) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read %s: %w", siteHome, err)
	}
	res, err := b.renderer.Render(src, siteHome)
	if err != nil {
		return "", fmt.Errorf("render %s: %w", siteHome, err)
	}
	return res.Title, nil
}

func (b *siteBuilder) writePage(notePath string) error {
	src, _, err := b.st.Read(notePath)
	if err != nil {
		return fmt.Errorf("read %s: %w", notePath, err)
	}
	res, err := b.renderer.Render(src, notePath)
	if err != nil {
		return fmt.Errorf("render %s: %w", notePath, err)
	}
	b.diagrams = b.diagrams || res.Diagrams

	up := siteUp(notePath)
	opts := page.Options{Math: b.math, Assets: up + siteAssets, Tree: treeEntries(b.tree, notePath, up)}
	if outline := render.OutlineOf(res.TOC); len(outline) >= render.MinOutline {
		opts.Outline = outline
	}
	if b.home != "" {
		opts.Home = &page.Link{Href: up + sitePageOf(siteHome), Title: b.home}
	}
	var buf bytes.Buffer
	if err = page.WriteNote(&buf, page.Note{Title: res.Title, HTML: string(res.HTML)}, opts); err != nil {
		return fmt.Errorf("write %s: %w", notePath, err)
	}
	return b.write(sitePageOf(notePath), buf.Bytes())
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

// siteNode is a folder or a note of the tree every page of a site carries.
type siteNode struct {
	name, path string
	dir        bool
	children   []siteNode
}

// siteTree is what the app's tree lists, less the folders that hold no note:
// in the app a folder is where a note is made, and a site makes none, so an
// empty folder or one of pictures would only stand in the way.
func siteTree(st *store.Store) ([]siteNode, error) {
	root, err := st.Tree()
	if err != nil {
		return nil, fmt.Errorf("list notes: %w", err)
	}
	return siteNodesOf(root), nil
}

func siteNodesOf(node *store.Node) []siteNode {
	res := []siteNode{}
	for _, child := range node.Children {
		if !child.InNavTree() {
			continue
		}
		entry := siteNode{name: child.Name, path: child.Path, dir: child.IsDir}
		if child.IsDir {
			if entry.children = siteNodesOf(child); len(entry.children) == 0 {
				continue
			}
		}
		res = append(res, entry)
	}
	return res
}

// treeEntries is the tree as the page of current shows it: its note marked,
// the folders on the way to it open, and every link relative to the page.
func treeEntries(nodes []siteNode, current, up string) []page.TreeEntry {
	res := make([]page.TreeEntry, 0, len(nodes))
	for _, node := range nodes {
		if node.dir {
			res = append(res, page.TreeEntry{
				Name:     node.name,
				Open:     strings.HasPrefix(current, node.path+"/"),
				Children: treeEntries(node.children, current, up),
			})
			continue
		}
		res = append(res, page.TreeEntry{
			Name:    node.name,
			Href:    up + (&url.URL{Path: sitePageOf(node.path)}).EscapedPath(),
			Current: node.path == current,
		})
	}
	return res
}

// siteFiles lists every file the site is made of, refusing the notes
// checkSiteNames refuses.
func siteFiles(st *store.Store) ([]store.FileInfo, error) {
	files, err := st.Files()
	if err != nil {
		return nil, fmt.Errorf("list notes: %w", err)
	}
	if nameErr := checkSiteNames(files); nameErr != nil {
		return nil, nameErr
	}
	return files, nil
}

// checkSiteNames refuses notes that would land on the same file of the site,
// as a.md and a.html do, or on the directory of the shared stylesheet.
func checkSiteNames(files []store.FileInfo) error {
	written := make(map[string]string, len(files))
	for _, entry := range files {
		if top, _, _ := strings.Cut(entry.Path, "/"); top == siteAssets {
			return fmt.Errorf("%s/ is where the site keeps its stylesheet, and the notes hold %s", siteAssets, entry.Path)
		}
		name := entry.Path
		if isMarkdown(name) {
			name = sitePageOf(name)
		}
		if other, ok := written[name]; ok {
			return fmt.Errorf("%s and %s would both be written to %s", other, entry.Path, name)
		}
		written[name] = entry.Path
	}
	return nil
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

// siteUp leads from the page of a note back to the root of the site. At the
// root it is "./", so a note named "a:b.md" is not read as the scheme "a:".
func siteUp(notePath string) string {
	if depth := strings.Count(notePath, "/"); depth > 0 {
		return strings.Repeat("../", depth)
	}
	return "./"
}

func sitePageOf(notePath string) string {
	return strings.TrimSuffix(notePath, path.Ext(notePath)) + sitePage
}
