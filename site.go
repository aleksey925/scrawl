package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
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
	for name, content := range page.Assets(page.Options{Math: opts.Math}) {
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

	up := strings.Repeat("../", strings.Count(notePath, "/"))
	opts := page.Options{Math: b.math, Assets: up + siteAssets}
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

func sitePageOf(notePath string) string {
	return strings.TrimSuffix(notePath, path.Ext(notePath)) + sitePage
}
