package render

import (
	"bytes"
	"html/template"
	"path"
	"strings"

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

type Heading struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
	ID    string `json:"id"`
}

type Result struct {
	HTML     template.HTML
	Title    string
	TOC      []Heading
	Mermaid  bool
	PlantUML bool
	Math     bool
}

type Options struct {
	LinkExists func(contentPath string) bool
	PagePrefix string
	RawPrefix  string
	Relative   bool
	PageExt    string
	FolderPage string
	IndexPage  string
}

type Renderer struct {
	md     goldmark.Markdown
	policy *bluemonday.Policy
	links  *linkTransformer
}

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
		relative:   opts.Relative,
		pageExt:    opts.PageExt,
		folderPage: opts.FolderPage,
		indexPage:  opts.IndexPage,
		exists:     opts.LinkExists,
	}
	md := goldmark.New(
		goldmark.WithExtensions(
			extension.NewTable(
				extension.WithTableCellAlignMethod(extension.TableCellAlignAttribute),
			),
			extension.Strikethrough,
			extension.TaskList,
			extension.NewLinkify(
				extension.WithLinkifyURLRegexp(linkifyURLRegexp),
				extension.WithLinkifyWWWRegexp(linkifyWWWRegexp),
			),
			extension.Footnote,
			emoji.New(emoji.WithRenderingMethod(emoji.Unicode)),
			highlighting.NewHighlighting(
				highlighting.WithCustomStyle(markupStyle),
				highlighting.WithFormatOptions(markupOptions...),
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
			html.WithUnsafe(),
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
	return Result{
		HTML:     out,
		Title:    title,
		TOC:      toc,
		Mermaid:  hasDiagram(string(out), mermaidClass),
		PlantUML: hasDiagram(string(out), PlantUMLClass),
		Math:     mathClass.MatchString(string(out)),
	}, nil
}

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
	clean = rewriteRawHTML(clean, linkResolvers{
		link:  func(dest string) target { return r.links.resolveLink(dest, dir) },
		embed: func(dest string) target { return r.links.resolveEmbed(dest, dir) },
	})
	return template.HTML(clean), nil //nolint:gosec // sanitized by bluemonday above
}

func contentDir(docPath string) string {
	dir := path.Dir(strings.TrimPrefix(path.Clean("/"+docPath), "/"))
	if dir == "." || dir == "/" {
		return ""
	}
	return dir
}

func titleFromPath(docPath string) string {
	name := path.Base(strings.TrimSuffix(docPath, "/"))
	if name == "." || name == "/" || name == "" {
		return ""
	}
	return strings.TrimSuffix(name, path.Ext(name))
}
