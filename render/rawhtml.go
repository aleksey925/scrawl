package render

import (
	"bytes"
	"errors"
	"io"
	"strings"

	"golang.org/x/net/html"
)

func rewriteRawHTML(fragment []byte, resolvers linkResolvers) []byte {
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
		raw := z.Raw()
		isTag := tt == html.StartTagToken || tt == html.SelfClosingTagToken
		if !isTag || !isLinkTag(rawTagName(raw)) {
			out.Write(raw)
			continue
		}
		tok := z.Token()
		patchTag(&tok, resolvers)
		out.WriteString(tok.String())
	}
}

func isLinkTag(name []byte) bool {
	return bytes.EqualFold(name, []byte("a")) ||
		bytes.EqualFold(name, []byte("img")) ||
		bytes.EqualFold(name, []byte("source"))
}

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

type linkResolvers struct {
	link, embed func(dest string) target
}

func patchTag(tok *html.Token, resolvers linkResolvers) {
	key := "href"
	resolve := resolvers.link
	isImage := tok.Data == "img"
	switch {
	case isImage:
		key, resolve = "src", resolvers.embed
	case tok.Data == "source":
		key, resolve = "srcset", resolvers.embed
	}
	local := false
	for i, attr := range tok.Attr {
		if attr.Key != key || attr.Namespace != "" {
			continue
		}
		if key == "srcset" {
			tok.Attr[i].Val = rewriteSrcset(attr.Val, resolve)
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

func rewriteSrcset(value string, resolve func(dest string) target) string {
	out := make([]string, 0, 4)
	for candidate := range strings.SplitSeq(value, ",") {
		url, descriptor, _ := strings.Cut(strings.TrimSpace(candidate), " ")
		if url == "" {
			continue
		}
		url = resolve(url).dest
		if descriptor = strings.TrimSpace(descriptor); descriptor != "" {
			url += " " + descriptor
		}
		out = append(out, url)
	}
	return strings.Join(out, ", ")
}

func ensureAttr(tok *html.Token, key, value string) {
	for _, attr := range tok.Attr {
		if attr.Key == key {
			return
		}
	}
	tok.Attr = append(tok.Attr, html.Attribute{Key: key, Val: value})
}
