package render

import (
	"bytes"
	"html/template"
	"path"
	"strings"

	chromahtml "github.com/alecthomas/chroma/v2/formatters/html"
	"github.com/microcosm-cc/bluemonday"
	"github.com/yuin/goldmark"
	emoji "github.com/yuin/goldmark-emoji"
	highlighting "github.com/yuin/goldmark-highlighting/v2"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

const (
	defaultPagePrefix = "/doc/"
	defaultRawPrefix  = "/raw/"
)

// Heading is one entry of the table of contents.
type Heading struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
	ID    string `json:"id"`
}

// Result is a rendered document.
type Result struct {
	HTML  template.HTML
	Title string
	TOC   []Heading
}

// Options configures a Renderer.
type Options struct {
	// LinkExists reports whether a content path exists. Optional; when set,
	// links to missing files are marked with the "broken" class.
	LinkExists func(contentPath string) bool
	// PagePrefix is the route prefix for markdown documents, "/doc/" by default.
	PagePrefix string
	// RawPrefix is the route prefix for every other file, "/raw/" by default.
	RawPrefix string
}

// Renderer turns markdown into sanitized HTML. It is safe for concurrent use:
// all per-document state lives in the parser.Context.
type Renderer struct {
	md     goldmark.Markdown
	policy *bluemonday.Policy
	links  *linkTransformer
}

// New builds a renderer. One instance serves every request.
func New(opts Options) *Renderer {
	if opts.PagePrefix == "" {
		opts.PagePrefix = defaultPagePrefix
	}
	if opts.RawPrefix == "" {
		opts.RawPrefix = defaultRawPrefix
	}
	links := &linkTransformer{
		pagePrefix: opts.PagePrefix,
		rawPrefix:  opts.RawPrefix,
		exists:     opts.LinkExists,
	}
	// goldmark's indented code block parser is kept on purpose. Removing it
	// was tried, because the corpus has 427 fenced blocks and zero indented
	// ones: it changed nothing in the corpus output and made goldmark drop
	// any top-level 4-space-indented line on the floor, silently.
	md := goldmark.New(
		goldmark.WithExtensions(
			// not extension.GFM: the default table renderer emits
			// style="text-align:...", which the sanitizer strips
			extension.NewTable(
				extension.WithTableCellAlignMethod(extension.TableCellAlignAttribute),
			),
			extension.Strikethrough,
			extension.TaskList,
			extension.Linkify, // 23 corpus URLs are written bare
			// the shape of the footnote output is not goldmark's: see
			// footnote.go, which re-renders all four of its nodes
			extension.Footnote,
			// GitHub replaces a shortcode with the unicode character; the
			// parser only fires on a name it knows, so ":" in prose and in
			// code is left alone
			emoji.New(emoji.WithRenderingMethod(emoji.Unicode)),
			highlighting.NewHighlighting(
				highlighting.WithStyle(codeStyle),
				highlighting.WithFormatOptions(
					chromahtml.WithClasses(true),
					chromahtml.WithLineNumbers(false),
				),
				highlighting.WithWrapperRenderer(codeWrapper),
			),
		),
		goldmark.WithParserOptions(
			parser.WithAutoHeadingID(),
			parser.WithBlockParsers(util.Prioritized(&mathBlockParser{}, 750)),
			parser.WithInlineParsers(util.Prioritized(&mathInlineParser{}, 500)),
			parser.WithASTTransformers(
				util.Prioritized(&alertTransformer{}, 400),
				util.Prioritized(&rawFenceTransformer{}, 450),
				util.Prioritized(links, 500),
				util.Prioritized(&tableWrapTransformer{}, 600),
				util.Prioritized(&srcLineTransformer{}, 700),
			),
		),
		goldmark.WithRendererOptions(
			html.WithUnsafe(), // <a name>, <details>; bluemonday cleans up after
			// a lower number wins, so these override the extensions that
			// registered the same node kinds at 500
			renderer.WithNodeRenderers(
				util.Prioritized(&tableWrapRenderer{}, 100),
				util.Prioritized(&indentedCodeRenderer{}, 100),
				util.Prioritized(&alertRenderer{}, 100),
				util.Prioritized(&rawBlockRenderer{}, 100),
				util.Prioritized(&footnoteRenderer{}, 100),
				util.Prioritized(&mathRenderer{}, 100),
				util.Prioritized(&detailsRenderer{}, 100),
				util.Prioritized(&blockquoteRenderer{}, 100),
			),
		),
	)
	return &Renderer{md: md, policy: newPolicy(), links: links}
}

// Render converts one document. docPath is the content path of the source,
// used to resolve relative links and as the title fallback.
func (r *Renderer) Render(src []byte, docPath string) (Result, error) {
	doc := preprocess(src)
	root, pctx := r.parse(doc, docPath)
	title, toc := outline(root, doc.src)
	if title == "" {
		title = titleFromPath(docPath)
	}
	out, err := r.finish(root, doc.src, pctx)
	if err != nil {
		return Result{}, err
	}
	return Result{HTML: out, Title: title, TOC: toc}, nil
}

// RenderInline converts a document without extracting the outline. It is the
// editor preview path, and produces byte-identical HTML to Render.
func (r *Renderer) RenderInline(src []byte, docPath string) (template.HTML, error) {
	doc := preprocess(src)
	root, pctx := r.parse(doc, docPath)
	return r.finish(root, doc.src, pctx)
}

func (r *Renderer) parse(doc document, docPath string) (ast.Node, parser.Context) {
	pctx := parser.NewContext(parser.WithIDs(newSlugIDs()))
	pctx.Set(docDirKey, contentDir(docPath))
	pctx.Set(srcLinesKey, newSrcLines(doc))
	return r.md.Parser().Parse(text.NewReader(doc.src), parser.WithContext(pctx)), pctx
}

func (r *Renderer) finish(root ast.Node, source []byte, pctx parser.Context) (template.HTML, error) {
	var buf bytes.Buffer
	if err := r.md.Renderer().Render(&buf, source, root); err != nil {
		return "", err
	}
	clean := r.policy.SanitizeBytes(buf.Bytes())
	dir, _ := pctx.Get(docDirKey).(string)
	clean = rewriteRawHTML(clean, func(dest string) target {
		return r.links.resolve(dest, dir)
	})
	clean = stripAnchorParagraphs(clean)
	return template.HTML(clean), nil //nolint:gosec // sanitized by bluemonday above
}

// contentDir is the directory of a content path, "" for the root.
func contentDir(docPath string) string {
	dir := path.Dir(strings.TrimPrefix(path.Clean("/"+docPath), "/"))
	if dir == "." || dir == "/" {
		return ""
	}
	return dir
}

// titleFromPath is the fallback title: the file name without its extension.
func titleFromPath(docPath string) string {
	name := path.Base(strings.TrimSuffix(docPath, "/"))
	if name == "." || name == "/" || name == "" {
		return ""
	}
	return strings.TrimSuffix(name, path.Ext(name))
}
