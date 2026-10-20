// Package page writes the HTML the command line hands out: a rendered note or a
// rendered diff as one file that opens on its own, with the stylesheet of the
// app inlined, or as a fragment to put into a page of somebody else's; and the
// pages of a site, each the app's reader started on the answer it carries.
package page

import (
	"embed"
	"fmt"
	"html/template"
	"io"

	"github.com/aleksey925/scrawl/gzassets"
	"github.com/aleksey925/scrawl/htmldiff"
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/theme"
)

var assets = gzassets.Sub(assetFiles, assetDir)

//go:embed templates/*.html
var templates embed.FS

var tmpl = template.Must(template.New("page").Funcs(template.FuncMap{
	"plural": plural,
	"rows":   rowsOf,
	"cell":   cellOf,
	"shown":  shownOf,
	"tag":    tagOf,
	"trust":  trust,
	"themes": theme.All,
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
	Layout  Layout
	Files   []File
}

// Layout is how the rows of a diff are laid out.
type Layout string

// The layouts of a diff; a Report that names none is Split.
const (
	// Split puts the version before beside the version after, block by block.
	Split Layout = "split"
	// Unified shows the note once, as it reads now, with a changed block's lost
	// and new words in one block.
	Unified Layout = "unified"
)

// Options are what a page carries beyond the note and its look.
type Options struct {
	// Math typesets formulas with KaTeX inlined into the page, some 600KB;
	// without it a formula stays the TeX it was written in
	Math bool
}

// Link is an address and the words it is shown as.
type Link struct {
	Href  string
	Title string
}

// SitePage is one page of a site. The reader draws the page from Data; the
// path, the note and the folder's entries are the same page for a reader
// without javascript.
type SitePage struct {
	Title string
	// Assets leads from the page to the directory SiteAssets are written to
	Assets string
	// Data is the answer the page stands for as JSON, from encoding/json,
	// which escapes every character that could close the script holding it
	Data []byte
	// Crumbs is the path to the page, the last one with no Href
	Crumbs []Link
	// HTML is the note, "" for a folder with neither an index nor a readme
	HTML string
	// Entries is what a folder holds, nil on the page of a note
	Entries []Link
}

// the files of a site's assets directory the pages of a site link, beside the
// ones the site writes itself; web/src/site/loaders.ts names the renderers
const (
	SiteBootFile   = "boot.js"
	SiteScriptFile = "site.js"
	SiteStyleFile  = "site.css"
	DiagramsFile   = "diagrams.js"
	MathScriptFile = "math.js"
	MathStyleFile  = "math.css"
)

// SiteAssets are the scripts and the stylesheet every page of a site links.
func SiteAssets() map[string]string {
	return map[string]string{
		SiteBootFile:   asset(SiteBootFile),
		SiteScriptFile: asset(SiteScriptFile),
		SiteStyleFile:  asset(SiteStyleFile),
	}
}

// Diagrams is the mermaid renderer a site writes as DiagramsFile, some 5MB,
// only when one of its notes has a diagram.
func Diagrams() string { return asset(DiagramsFile) }

// Math is the formula renderer a site writes as MathScriptFile and
// MathStyleFile, only when one of its notes has a formula.
func Math() map[string]string {
	return map[string]string{MathScriptFile: asset(MathScriptFile), MathStyleFile: asset(MathStyleFile)}
}

// barColor is one theme-color meta of a page.
type barColor struct {
	Color string
	Media string
}

// siteBars follow the system, as a page of a site does until a theme is picked
var siteBars = func() []barColor {
	res := []barColor{}
	for _, scheme := range []theme.Scheme{theme.Light, theme.Dark} {
		res = append(res, barColor{
			Color: theme.AutoTheme(scheme).BarColor(),
			Media: "(prefers-color-scheme: " + string(scheme) + ")",
		})
	}
	return res
}()

// WriteSitePage writes one page of a site.
func WriteSitePage(w io.Writer, p SitePage) error {
	return execute(w, "site.html", struct {
		SitePage
		Data template.JS
		Bars []barColor
	}{
		SitePage: p,
		Data:     template.JS(p.Data), //nolint:gosec // JSON from encoding/json, which escapes <, > and &
		Bars:     siteBars,
	})
}

// WriteNotFound writes the page a host answers a missing address of a site with.
func WriteNotFound(w io.Writer) error {
	return execute(w, "404.html", nil)
}

// WriteNote writes a note as a page of its own.
func WriteNote(w io.Writer, note Note, opts Options) error {
	return execute(w, "note.html", struct {
		Note
		Head head
	}{Note: note, Head: newHead(note.Title, opts)})
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

// asset reads a file the package embeds, which only a broken build lacks.
func asset(name string) string {
	data, err := assets.ReadFile(name)
	if err != nil {
		panic(fmt.Sprintf("page: embedded asset %s: %v", name, err))
	}
	return string(data)
}

type head struct {
	Title  string
	Style  template.CSS
	Script template.JS
}

func newHead(title string, opts Options) head {
	style, script := Stylesheet(), asset("page.js")
	if opts.Math {
		style += "\n" + asset(MathStyleFile)
		script += "\n" + asset(MathScriptFile)
	}
	return head{
		Title:  title,
		Style:  template.CSS(style), //nolint:gosec // our own stylesheet, embedded at build time
		Script: template.JS(script), //nolint:gosec // our own script, embedded at build time
	}
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

func plural(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}

// rowsData is what the rows template draws for one file.
type rowsData struct {
	File     File
	Layout   Layout
	Segments []segment
}

func rowsOf(file File, context int, layout Layout) rowsData {
	if layout == "" {
		layout = Split
	}
	return rowsData{File: file, Layout: layout, Segments: fold(file.Rows, context)}
}

// cellData is one side of a split row; a nil Side is a block that side does
// not have.
type cellData struct {
	Side  *htmldiff.Side
	Which string
}

func cellOf(side *htmldiff.Side, which string) cellData {
	return cellData{Side: side, Which: which}
}

// shownOf is what a row shows in the unified layout: a removed block as
// it was, a changed one with its lost and its new words in one block, or both
// sides when that block could not be built, and anything else as it is now.
// web/src/diff/RenderedDiff.tsx shows the same.
func shownOf(row htmldiff.Row) []*htmldiff.Side {
	switch {
	case row.Kind == htmldiff.Removed:
		return []*htmldiff.Side{row.Old}
	case row.Kind == htmldiff.Changed && row.Inline != nil:
		return []*htmldiff.Side{row.Inline}
	case row.Kind == htmldiff.Changed:
		return []*htmldiff.Side{row.Old, row.New}
	default:
		return []*htmldiff.Side{row.New}
	}
}

// tagOf is the word beside a block that says what happened to it, none for a
// block that stayed as it was
func tagOf(kind htmldiff.Kind) string {
	switch kind {
	case htmldiff.Changed:
		return "Changed"
	case htmldiff.Added:
		return "Added"
	case htmldiff.Removed:
		return "Removed"
	case htmldiff.Format:
		return "Format"
	default:
		return ""
	}
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
