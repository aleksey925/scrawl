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
	relative   bool
	pageExt    string
	folderPage string
	indexPage  string
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
			tg := t.resolveLink(string(node.Destination), dir)
			node.Destination = []byte(tg.dest)
			t.decorate(node, tg, false)
		case *ast.Image:
			tg := t.resolveEmbed(string(node.Destination), dir)
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

// resolveEmbed maps the destination of an embedded resource, a picture or a source
// of one, relative to dir: the browser fetches it as bytes, so a file that is
// not a note goes to the raw route. It is idempotent: an absolute URL, an app
// route and a bare fragment all pass through unchanged.
func (t *linkTransformer) resolveEmbed(dest, dir string) target {
	return t.route(dest, dir, true)
}

// resolveLink maps the destination of a link, which a reader follows to a page:
// every local file has one, so a link to a picture or a pdf opens its page the
// way a row of a folder does.
func (t *linkTransformer) resolveLink(dest, dir string) target {
	return t.route(dest, dir, false)
}

func (t *linkTransformer) route(dest, dir string, embed bool) target {
	u, passthrough, ok := parseLocal(dest)
	if !ok {
		return passthrough
	}
	if t.relative {
		return t.keepRelative(u, dest)
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
	case isMarkdown(u.Path) || !embed:
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
// index and the editor treat as a document: an embedded picture of any other
// name is fetched as bytes from /raw/, and a site swaps only ".md" for a page.
func isMarkdown(p string) bool { return strings.EqualFold(path.Ext(p), ".md") }

// keepRelative leaves a relative destination as written, swapping only the
// extension of a document when one was asked for. The root is not checked:
// outside the app there is no notes root for a link to escape.
func (t *linkTransformer) keepRelative(u *url.URL, dest string) target {
	swapped := *u
	switch {
	case t.folderPage != "" && isFolder(u.Path):
		swapped.Path = strings.TrimSuffix(u.Path, "/") + "/" + t.folderPage
	case t.indexPage != "" && strings.EqualFold(path.Base(u.Path), folderIndex):
		swapped.Path = path.Join(path.Dir(u.Path), t.indexPage)
	case t.pageExt != "" && isMarkdown(u.Path):
		swapped.Path = strings.TrimSuffix(u.Path, path.Ext(u.Path)) + t.pageExt
	default:
		return target{dest: dest}
	}
	return target{dest: swapped.String(), rewrote: true}
}

// folderIndex is a folder's own note, written to indexPage on a site.
const folderIndex = "index.md"

// isFolder is a relative destination that names a folder: a trailing slash, or
// the folder itself or its parent with none.
func isFolder(p string) bool {
	return strings.HasSuffix(p, "/") || p == "." || p == ".." || strings.HasSuffix(p, "/..") || strings.HasSuffix(p, "/.")
}
