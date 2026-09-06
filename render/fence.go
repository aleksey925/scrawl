package render

import (
	"strings"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

const (
	openMermaid      = `<pre class="mermaid">`
	closeMermaid     = "</pre>\n"
	openDisplayMath  = `<div class="math math-display">`
	closeDisplayMath = "</div>\n"
)

// GitHub gives two fence languages a meaning of their own: "mermaid" is a
// diagram and "math" is a display formula. Both reach the client as source
// rather than as highlighted code, so they are lifted out of the fenced code
// block here, before the highlighting extension ever sees them.
var rawFenceTags = map[string][2]string{
	"mermaid": {openMermaid, closeMermaid},
	"math":    {openDisplayMath, closeDisplayMath},
}

var kindRawBlock = ast.NewNodeKind("RawBlock")

// rawBlock holds source that is handed to the frontend verbatim, wrapped in
// markup it hydrates. Both the mermaid and math fences and the "$$" math block
// produce one.
type rawBlock struct {
	ast.BaseBlock
	open   string
	close  string
	closed bool // set by the "$$" block parser once it has seen the closer
}

func (n *rawBlock) Kind() ast.NodeKind { return kindRawBlock }

func (n *rawBlock) IsRaw() bool { return true }

func (n *rawBlock) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, map[string]string{"Open": n.open}, nil)
}

type rawFenceTransformer struct{}

func (t *rawFenceTransformer) Transform(doc *ast.Document, reader text.Reader, _ parser.Context) {
	source := reader.Source()
	var fences []*ast.FencedCodeBlock
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if fenced, ok := n.(*ast.FencedCodeBlock); ok && entering {
			fences = append(fences, fenced)
		}
		return ast.WalkContinue, nil
	})
	for _, fenced := range fences {
		tags, ok := rawFenceTags[strings.ToLower(string(fenced.Language(source)))]
		if !ok {
			continue
		}
		parent := fenced.Parent()
		if parent == nil {
			continue
		}
		node := &rawBlock{open: tags[0], close: tags[1]}
		node.SetLines(fenced.Lines())
		parent.ReplaceChild(parent, fenced, node)
	}
}

type rawBlockRenderer struct{}

func (r *rawBlockRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(kindRawBlock, r.render)
}

func (r *rawBlockRenderer) render(
	w util.BufWriter, source []byte, node ast.Node, entering bool,
) (ast.WalkStatus, error) {
	n := node.(*rawBlock)
	if !entering {
		_, _ = w.WriteString(n.close)
		return ast.WalkContinue, nil
	}
	_, _ = w.WriteString(n.open)
	lines := n.Lines()
	for i := range lines.Len() {
		line := lines.At(i)
		html.DefaultWriter.RawWrite(w, line.Value(source))
	}
	return ast.WalkContinue, nil
}
