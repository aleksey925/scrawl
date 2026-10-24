package render

import (
	"net/url"
	"path"
	"strings"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

var docDirKey = parser.NewContextKey()

const brokenClass = "broken"

type linkTransformer struct {
	pagePrefix string
	rawPrefix  string
	relative   bool
	pageExt    string
	folderPage string
	indexPage  string
	exists     func(contentPath string) bool
}

type target struct {
	dest     string
	content  string
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

func (t *linkTransformer) resolveEmbed(dest, dir string) target {
	return t.route(dest, dir, true)
}

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
		return target{dest: "#", broken: true}
	}
	if clean == "." {
		clean = ""
	}

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
		return nil, target{dest: dest}, false
	case strings.HasPrefix(u.Path, "/"):
		return nil, target{dest: dest}, false
	}
	return u, target{}, true
}

func isMarkdown(p string) bool { return strings.EqualFold(path.Ext(p), ".md") }

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

const folderIndex = "index.md"

func isFolder(p string) bool {
	return strings.HasSuffix(p, "/") || p == "." || p == ".." || strings.HasSuffix(p, "/..") || strings.HasSuffix(p, "/.")
}
