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

type Note struct {
	Title string
	HTML  string
}

type File struct {
	Path     string
	OldPath  string
	Status   Status
	OldLabel string
	NewLabel string
	Rows     []htmldiff.Row
}

type Status string

const (
	Added    Status = "added"
	Modified Status = "modified"
	Deleted  Status = "deleted"
	Renamed  Status = "renamed"
)

func (f File) Stats() htmldiff.Stats { return htmldiff.Count(f.Rows) }

type Report struct {
	Title   string
	Context int
	Layout  Layout
	Files   []File
}

type Layout string

const (
	Split   Layout = "split"
	Unified Layout = "unified"
)

type Options struct {
	Math bool
}

type Link struct {
	Href  string
	Title string
}

type SitePage struct {
	Title   string
	Assets  string
	Data    []byte
	Crumbs  []Link
	HTML    string
	Entries []Link
}

const (
	SiteBootFile   = "boot.js"
	SiteScriptFile = "site.js"
	SiteStyleFile  = "site.css"
	MermaidFile    = "mermaid.js"
	PlantUMLFile   = "plantuml.js"
	MathScriptFile = "math.js"
	MathStyleFile  = "math.css"
)

func SiteAssets() map[string]string {
	return map[string]string{
		SiteBootFile:   asset(SiteBootFile),
		SiteScriptFile: asset(SiteScriptFile),
		SiteStyleFile:  asset(SiteStyleFile),
	}
}

func Mermaid() string { return asset(MermaidFile) }

func PlantUML() string { return asset(PlantUMLFile) }

func Math() map[string]string {
	return map[string]string{MathScriptFile: asset(MathScriptFile), MathStyleFile: asset(MathStyleFile)}
}

type barColor struct {
	Color string
	Media string
}

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

func WriteNotFound(w io.Writer) error {
	return execute(w, "404.html", nil)
}

func WriteNote(w io.Writer, note Note, opts Options) error {
	return execute(w, "note.html", struct {
		Note
		Head head
	}{Note: note, Head: newHead(note.Title, opts)})
}

func WriteDiff(w io.Writer, rep Report, opts Options) error {
	return execute(w, "diff.html", struct {
		Report
		Head head
	}{Report: rep, Head: newHead(rep.Title, opts)})
}

func WriteDiffFragment(w io.Writer, rep Report) error {
	return execute(w, "files", rep)
}

func Stylesheet() string {
	return asset("page.css") + "\n" + string(render.ChromaCSS())
}

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

func trust(s string) template.HTML {
	return template.HTML(s) //nolint:gosec // sanitized by render's bluemonday policy
}

func plural(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}

type rowsData struct {
	File     File
	Layout   Layout
	Split    bool
	Segments []segment
}

func rowsOf(file File, context int, layout Layout) rowsData {
	if layout == "" {
		layout = Split
	}
	return rowsData{File: file, Layout: layout, Split: layout == Split, Segments: fold(file.Rows, context)}
}

type cellData struct {
	Side  *htmldiff.Side
	Which string
}

func cellOf(side *htmldiff.Side, which string) cellData {
	return cellData{Side: side, Which: which}
}

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

type segment struct {
	Folded bool
	Rows   []htmldiff.Row
}

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
