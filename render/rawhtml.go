package render

import (
	"bytes"
	"errors"
	"io"
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

// rewriteRawHTML patches href and src on hand-written HTML, which the AST
// transformer never sees because goldmark keeps a raw HTML block as one
// opaque blob. It works on tokens rather than on a parsed tree: re-serializing
// a tree would silently restructure invalid-but-harmless markup such as an
// <h3> inside a <p>, which this corpus produces.
//
// resolve is idempotent, so the links the AST pass already rewrote survive a
// second visit untouched.
func rewriteRawHTML(fragment []byte, resolve func(dest string) target) []byte {
	var out bytes.Buffer
	out.Grow(len(fragment))
	z := html.NewTokenizer(bytes.NewReader(fragment))
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			if !errors.Is(z.Err(), io.EOF) {
				return fragment
			}
			return out.Bytes()
		}
		// the tag name is read straight from the raw bytes: calling
		// Tokenizer.TagName first would leave Token with nothing to parse
		raw := z.Raw()
		isTag := tt == html.StartTagToken || tt == html.SelfClosingTagToken
		if !isTag || !isLinkTag(rawTagName(raw)) {
			out.Write(raw)
			continue
		}
		tok := z.Token()
		patchTag(&tok, resolve)
		out.WriteString(tok.String())
	}
}

// reAnchorParagraph matches a paragraph holding nothing but the corpus's
// manual anchors. goldmark wraps a lone <a name='x'></a> line in a paragraph,
// which puts an empty 16px-tall block above 249 headings.
var reAnchorParagraph = regexp.MustCompile(`<p>((?:\s*<a name="[^"]*"></a>)+)\s*</p>`)

func stripAnchorParagraphs(fragment []byte) []byte {
	return reAnchorParagraph.ReplaceAll(fragment, []byte("$1"))
}

func isLinkTag(name []byte) bool {
	return bytes.EqualFold(name, []byte("a")) || bytes.EqualFold(name, []byte("img"))
}

// rawTagName reads the element name out of a raw "<name ...>" token.
func rawTagName(raw []byte) []byte {
	if len(raw) < 2 || raw[0] != '<' {
		return nil
	}
	end := bytes.IndexAny(raw[1:], " \t\n\r\f/>")
	if end < 0 {
		return raw[1:]
	}
	return raw[1 : 1+end]
}

func patchTag(tok *html.Token, resolve func(dest string) target) {
	key := "href"
	isImage := tok.Data == "img"
	if isImage {
		key = "src"
	}
	local := false
	for i, attr := range tok.Attr {
		if attr.Key != key || attr.Namespace != "" {
			continue
		}
		tg := resolve(attr.Val)
		tok.Attr[i].Val = tg.dest
		local = tg.rewrote || strings.HasPrefix(tg.dest, "/")
	}
	if isImage && local {
		ensureAttr(tok, "loading", "lazy")
		ensureAttr(tok, "decoding", "async")
	}
}

func ensureAttr(tok *html.Token, key, value string) {
	for _, attr := range tok.Attr {
		if attr.Key == key {
			return
		}
	}
	tok.Attr = append(tok.Attr, html.Attribute{Key: key, Val: value})
}
