package render

import (
	"net/url"
	"path"
	"strings"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

// docDirKey carries the directory of the document being rendered, so one
// goldmark pipeline can serve every request concurrently.
var docDirKey = parser.NewContextKey()

const brokenClass = "broken"

// linkTransformer maps relative destinations onto the app routes and marks
// external and broken links.
type linkTransformer struct {
	pagePrefix string
	rawPrefix  string
	exists     func(contentPath string) bool
}

// target is the outcome of resolving one destination.
type target struct {
	dest     string
	content  string // content path to check for existence, empty when n/a
	external bool
	broken   bool
	rewrote  bool
}

func (t *linkTransformer) Transform(doc *ast.Document, _ text.Reader, pc parser.Context) {
	dir, _ := pc.Get(docDirKey).(string)
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch node := n.(type) {
		case *ast.Link:
			tg := t.resolve(string(node.Destination), dir)
			node.Destination = []byte(tg.dest)
			t.decorate(node, tg, false)
		case *ast.Image:
			tg := t.resolve(string(node.Destination), dir)
			node.Destination = []byte(tg.dest)
			t.decorate(node, tg, true)
		case *ast.AutoLink:
			if node.AutoLinkType == ast.AutoLinkURL {
				setExternal(node)
			}
		}
		return ast.WalkContinue, nil
	})
}

func (t *linkTransformer) decorate(n ast.Node, tg target, isImage bool) {
	switch {
	case tg.external:
		if !isImage {
			setExternal(n)
		}
	case tg.rewrote && isImage:
		n.SetAttributeString("loading", []byte("lazy"))
		n.SetAttributeString("decoding", []byte("async"))
	}
	if tg.broken || (tg.content != "" && t.exists != nil && !t.exists(tg.content)) {
		n.SetAttributeString("class", []byte(brokenClass))
	}
}

func setExternal(n ast.Node) {
	n.SetAttributeString("target", []byte("_blank"))
	n.SetAttributeString("rel", []byte("noopener noreferrer"))
}

// resolve maps one destination, relative to dir. It is idempotent: an
// absolute URL, an app route and a bare fragment all pass through unchanged.
func (t *linkTransformer) resolve(dest, dir string) target {
	u, passthrough, ok := parseLocal(dest)
	if !ok {
		return passthrough
	}

	clean := path.Join(dir, u.Path)
	if clean == ".." || strings.HasPrefix(clean, "../") {
		// escapes the notes root, so there is nothing to point at
		return target{dest: "#", broken: true}
	}
	if clean == "." {
		clean = ""
	}

	// escape here rather than leaving it to goldmark: the same destination is
	// reused by the raw HTML pass, which has no escaping of its own
	escaped := (&url.URL{Path: clean}).EscapedPath()
	route := t.rawPrefix + escaped
	switch {
	case strings.HasSuffix(u.Path, "/"):
		route = t.pagePrefix + escaped + "/"
	case isMarkdown(u.Path):
		route = t.pagePrefix + escaped
	}
	if u.RawQuery != "" {
		route += "?" + u.RawQuery
	}
	if u.Fragment != "" {
		route += "#" + u.EscapedFragment()
	}
	return target{dest: route, content: clean, rewrote: true}
}

// parseLocal splits off every destination that must survive untouched: a bare
// fragment, an absolute URL, a non-http scheme and an app route that has
// already been rewritten. ok is false when the caller should use the returned
// target as is.
func parseLocal(dest string) (u *url.URL, passthrough target, ok bool) {
	if dest == "" || strings.HasPrefix(dest, "#") {
		return nil, target{dest: dest}, false
	}
	u, err := url.Parse(dest)
	if err != nil {
		return nil, target{dest: dest, broken: true}, false
	}
	switch {
	case u.Scheme == "http" || u.Scheme == "https":
		return nil, target{dest: dest, external: true}, false
	case u.Scheme != "" || strings.HasPrefix(dest, "//"):
		// mailto:, tel: and anything else stay as written; the sanitizer has
		// the final say on which schemes survive
		return nil, target{dest: dest}, false
	case strings.HasPrefix(u.Path, "/"):
		return nil, target{dest: dest}, false
	}
	return u, target{}, true
}

// isMarkdown reports whether a destination points at a document. Only ".md"
// counts, because that is the one extension the store, the tree, the search
// index and the editor treat as a document: rewriting anything else to /doc/
// would send the reader to a page that cannot exist.
func isMarkdown(p string) bool { return strings.EqualFold(path.Ext(p), ".md") }
