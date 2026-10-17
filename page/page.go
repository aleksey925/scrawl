// Package page writes the HTML the command line hands out: a rendered note or a
// rendered diff as one file that opens on its own, with the stylesheet of the
// app inlined, as a page of a site that links one shared copy of it, or as a
// fragment to put into a page of somebody else's.
package page

import (
	"embed"
	"fmt"
	"html/template"
	"io"
	"strings"

	"github.com/aleksey925/scrawl/htmldiff"
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/theme"
)

// assets are built from web/src/page by `make ui`, which writes them here.
//
//go:embed assets/page.css assets/page.js assets/math.css assets/math.js assets/diagrams.js
var assets embed.FS

//go:embed templates/*.html
var templates embed.FS

var tmpl = template.Must(template.New("page").Funcs(template.FuncMap{
	"plural": plural,
	"rows":   rowsOf,
	"cell":   cellOf,
	"trust":  trust,
	"themes": theme.All,
	"level":  levelOf,
	"inc":    func(n int) int { return n + 1 },
}).ParseFS(templates, "templates/*.html"))

// Note is one rendered note.
type Note struct {
	Title string
	HTML  string
}

// File is the comparison of one note.
type File struct {
	Path string
	// OldPath is where the note was before a rename, "" when it was not moved
	OldPath  string
	Status   Status
	OldLabel string
	NewLabel string
	Rows     []htmldiff.Row
}

// Status is what happened to a file between the two sides.
type Status string

// The statuses a compared file can have.
const (
	Added    Status = "added"
	Modified Status = "modified"
	Deleted  Status = "deleted"
	Renamed  Status = "renamed"
)

// Stats counts the changed blocks of the file.
func (f File) Stats() htmldiff.Stats { return htmldiff.Count(f.Rows) }

// Report is a comparison of any number of notes.
type Report struct {
	Title string
	// Context is how many unchanged blocks stay in sight around a change.
	Context int
	Files   []File
}

// Options are what a page carries beyond the note and its look.
type Options struct {
	// Math typesets formulas with KaTeX inlined into the page, some 600KB;
	// without it a formula stays the TeX it was written in
	Math bool
	// Assets is the address of the directory holding StylesheetFile and
	// ScriptFile, relative to the page. Empty inlines both into the page.
	Assets string
	// Home is the front page of the site the page belongs to, nil for none.
	Home *Link
	// Tree is the navigation of the site beside the note. With it the page is
	// a page of a site, laid out with the tree, the note and the outline.
	Tree []TreeEntry
	// Outline is the headings listed beside the note, nil for none.
	Outline []render.Heading
}

// Link is an address and the words it is shown as.
type Link struct {
	Href  string
	Title string
}

// TreeEntry is one row of the tree of a site: a folder and what it holds, or
// a note.
type TreeEntry struct {
	Name string
	// Href is where the note is, "" for a folder.
	Href string
	// Current is the note on this page.
	Current bool
	// Open is a folder on the way to the note on this page.
	Open     bool
	Children []TreeEntry
}

// the files a page with Options.Assets links to instead of inlining them, and
// the diagram renderer its script loads from beside itself on a page that has
// a diagram; web/src/page/page.ts names that one too
const (
	StylesheetFile = "page.css"
	ScriptFile     = "page.js"
	DiagramsFile   = "diagrams.js"
)

// Assets are the stylesheet and the script every page links to when they are
// files of their own, keyed by StylesheetFile and ScriptFile.
func Assets(opts Options) map[string]string {
	style, script := pageAssets(opts)
	return map[string]string{StylesheetFile: style, ScriptFile: script}
}

// Diagrams is the mermaid renderer a site writes as DiagramsFile, some 5MB,
// only when one of its notes has a diagram.
func Diagrams() string { return asset(DiagramsFile) }

// WriteNote writes a note as a page of its own, or as a page of a site when
// the options carry a tree.
func WriteNote(w io.Writer, note Note, opts Options) error {
	name := "note.html"
	if opts.Tree != nil {
		name = "site.html"
	}
	return execute(w, name, struct {
		Note
		Head    head
		Home    *Link
		Tree    []TreeEntry
		Outline []render.Heading
	}{Note: note, Head: newHead(note.Title, opts), Home: opts.Home, Tree: opts.Tree, Outline: opts.Outline})
}

// WriteDiff writes a report as a page of its own.
func WriteDiff(w io.Writer, rep Report, opts Options) error {
	return execute(w, "diff.html", struct {
		Report
		Head head
	}{Report: rep, Head: newHead(rep.Title, opts)})
}

// WriteDiffFragment writes the files of a report and nothing around them, for
// a page that brings the stylesheet itself.
func WriteDiffFragment(w io.Writer, rep Report) error {
	return execute(w, "files", rep)
}

// Stylesheet is everything a fragment needs from the outside: the look of a
// note and of a diff, in every theme, the highlighting of code included.
func Stylesheet() string {
	return asset("page.css") + "\n" + string(render.ChromaCSS())
}

// asset reads a file go:embed already proved is there.
func asset(name string) string {
	data, err := assets.ReadFile("assets/" + name)
	if err != nil {
		panic(fmt.Sprintf("page: embedded asset %s: %v", name, err))
	}
	return string(data)
}

type head struct {
	Title     string
	Style     template.CSS
	Script    template.JS
	StyleHref string
	ScriptSrc string
}

func newHead(title string, opts Options) head {
	if opts.Assets != "" {
		base := strings.TrimSuffix(opts.Assets, "/") + "/"
		return head{Title: title, StyleHref: base + StylesheetFile, ScriptSrc: base + ScriptFile}
	}
	style, script := pageAssets(opts)
	return head{
		Title:  title,
		Style:  template.CSS(style), //nolint:gosec // our own stylesheet, embedded at build time
		Script: template.JS(script), //nolint:gosec // our own script, embedded at build time
	}
}

func pageAssets(opts Options) (style, script string) {
	style, script = Stylesheet(), asset("page.js")
	if opts.Math {
		style += "\n" + asset("math.css")
		script += "\n" + asset("math.js")
	}
	return style, script
}

func execute(w io.Writer, name string, data any) error {
	if err := tmpl.ExecuteTemplate(w, name, data); err != nil {
		return fmt.Errorf("page: %w", err)
	}
	return nil
}

// trust marks HTML that render sanitized and htmldiff marked as safe to write
// as it is.
func trust(s string) template.HTML {
	return template.HTML(s) //nolint:gosec // sanitized by render's bluemonday policy
}

// treeLevel is the entries of one folder of a tree and how deep it sits.
type treeLevel struct {
	Entries []TreeEntry
	Depth   int
}

func levelOf(entries []TreeEntry, depth int) treeLevel {
	return treeLevel{Entries: entries, Depth: depth}
}

func plural(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}

// rowsData is what the rows template draws for one file.
type rowsData struct {
	File     File
	Segments []segment
}

func rowsOf(file File, context int) rowsData {
	return rowsData{File: file, Segments: fold(file.Rows, context)}
}

// cellData is one side of a row; a nil Side is a block that side does not have.
type cellData struct {
	Side  *htmldiff.Side
	Which string
}

func cellOf(side *htmldiff.Side, which string) cellData {
	return cellData{Side: side, Which: which}
}

// segment is a stretch of rows that is either in sight or folded away.
type segment struct {
	Folded bool
	Rows   []htmldiff.Row
}

// fold keeps every change and context rows around it in sight, and puts each
// stretch of unchanged rows between them under one fold. The app folds the
// same way in web/src/diff/fold.ts.
func fold(rows []htmldiff.Row, context int) []segment {
	shown := make([]bool, len(rows))
	for i, row := range rows {
		if !isChange(row) {
			continue
		}
		for k := max(0, i-context); k <= min(len(rows)-1, i+context); k++ {
			shown[k] = true
		}
	}
	res := []segment{}
	for i, row := range rows {
		folded := !shown[i]
		if n := len(res); n > 0 && res[n-1].Folded == folded {
			res[n-1].Rows = append(res[n-1].Rows, row)
			continue
		}
		res = append(res, segment{Folded: folded, Rows: []htmldiff.Row{row}})
	}
	return res
}

func isChange(row htmldiff.Row) bool {
	return row.Kind != htmldiff.Same && row.Kind != htmldiff.Format
}
