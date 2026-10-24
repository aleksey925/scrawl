package server

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strings"

	"golang.org/x/net/html"

	"github.com/aleksey925/scrawl/page"
	"github.com/aleksey925/scrawl/render"
	"github.com/aleksey925/scrawl/store"
)

const (
	exportMarkdown = "md"
	exportHTML     = "html"
)

const maxEmbeddedImages = 32 << 20

var exportRenderer = render.New(render.Options{Relative: true})

func (m *mount) apiExport(w http.ResponseWriter, r *http.Request) {
	p, ok := contentPath(r, "path")
	if !ok || !isMarkdown(p) {
		jsonError(w, http.StatusBadRequest, "only a note can be exported")
		return
	}
	format := r.URL.Query().Get("format")
	if format != exportMarkdown && format != exportHTML {
		jsonError(w, http.StatusBadRequest, "format must be md or html")
		return
	}

	f, fi, err := m.spc.Store.Open(p)
	if err != nil {
		failJSON(w, r, err)
		return
	}
	defer f.Close()

	if format == exportMarkdown {
		setExportHeaders(w, "text/markdown; charset=utf-8", fi.Name)
		if _, copyErr := io.Copy(w, f); copyErr != nil {
			logFailure(r, http.StatusInternalServerError, fmt.Errorf("write export: %w", copyErr))
		}
		return
	}

	data, err := io.ReadAll(io.LimitReader(f, maxRenderBytes+1))
	if err != nil {
		failJSON(w, r, err)
		return
	}
	if data, err = m.exportPage(p, data); err != nil {
		failJSON(w, r, err)
		return
	}
	setExportHeaders(w, "text/html; charset=utf-8", strings.TrimSuffix(fi.Name, path.Ext(fi.Name))+".html")
	if _, writeErr := w.Write(data); writeErr != nil {
		logFailure(r, http.StatusInternalServerError, fmt.Errorf("write export: %w", writeErr))
	}
}

func setExportHeaders(w http.ResponseWriter, contentType, name string) {
	h := w.Header()
	h.Set("Content-Type", contentType)
	h.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	h.Set("Content-Security-Policy", rawContentSecurityPolicy)
	h.Set("Cache-Control", pageCacheControl)
}

func (m *mount) exportPage(docPath string, src []byte) ([]byte, error) {
	res, err := renderWithDeadline(docPath, src, maxRenderBytes, renderTimeout, func() (render.Result, error) {
		return exportRenderer.Render(src, docPath)
	})
	if err != nil {
		return nil, err
	}
	pics := newPictures(m.spc.Store, path.Dir(docPath), maxEmbeddedImages)
	var buf bytes.Buffer
	note := page.Note{Title: res.Title, HTML: pics.embed(string(res.HTML))}
	if err := page.WriteNote(&buf, note, page.Options{Math: res.Math}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

type pictures struct {
	notes  *store.Store
	dir    string
	budget int64
	done   map[string]string
}

func newPictures(notes *store.Store, dir string, budget int64) *pictures {
	return &pictures{notes: notes, dir: dir, budget: budget, done: map[string]string{}}
}

func (p *pictures) embed(fragment string) string {
	var out strings.Builder
	z := html.NewTokenizer(strings.NewReader(fragment))
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			return out.String()
		}
		if tt != html.StartTagToken && tt != html.SelfClosingTagToken {
			out.Write(z.Raw())
			continue
		}
		raw := bytes.Clone(z.Raw())
		tok := z.Token()
		if !p.rewrite(&tok) {
			out.Write(raw)
			continue
		}
		out.WriteString(tok.String())
	}
}

func (p *pictures) rewrite(tok *html.Token) bool {
	changed := false
	for i, attr := range tok.Attr {
		var value string
		switch {
		case tok.Data == "img" && attr.Key == "src":
			value = p.dataURL(attr.Val)
		case tok.Data == "source" && attr.Key == "srcset":
			value = p.srcset(attr.Val)
		default:
			continue
		}
		if value != attr.Val {
			tok.Attr[i].Val, changed = value, true
		}
	}
	return changed
}

func (p *pictures) srcset(value string) string {
	candidates := strings.Split(value, ",")
	for i, candidate := range candidates {
		fields := strings.Fields(candidate)
		if len(fields) == 0 {
			continue
		}
		fields[0] = p.dataURL(fields[0])
		candidates[i] = strings.Join(fields, " ")
	}
	return strings.Join(candidates, ", ")
}

func (p *pictures) dataURL(src string) string {
	clean, fragment, ok := p.resolve(src)
	if !ok {
		return src
	}
	if embedded, cached := p.done[clean]; cached {
		return p.charge(src, embedded, fragment)
	}
	contentType, _ := rawContentType(clean)
	if !strings.HasPrefix(contentType, "image/") {
		return src
	}
	prefix := "data:" + contentType + ";base64,"
	fi, err := p.notes.Stat(clean)
	if err != nil || fi.IsDir || fi.Size > p.budget ||
		int64(len(prefix)+base64.StdEncoding.EncodedLen(int(fi.Size))+len(fragment)) > p.budget {
		return src
	}
	data, read := p.read(clean, fi.Size)
	if !read {
		return src
	}
	embedded := prefix + base64.StdEncoding.EncodeToString(data)
	res := p.charge(src, embedded, fragment)
	if res != src {
		p.done[clean] = embedded
	}
	return res
}

func (p *pictures) resolve(src string) (clean, fragment string, ok bool) {
	u, err := url.Parse(src)
	if err != nil || u.Scheme != "" || u.Host != "" || u.Path == "" || strings.HasPrefix(u.Path, "/") {
		return "", "", false
	}
	clean = path.Join(p.dir, u.Path)
	if clean == ".." || strings.HasPrefix(clean, "../") {
		return "", "", false
	}
	if u.Fragment != "" {
		fragment = "#" + u.EscapedFragment()
	}
	return clean, fragment, true
}

func (p *pictures) read(name string, size int64) ([]byte, bool) {
	f, _, err := p.notes.Open(name)
	if err != nil {
		return nil, false
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, size+1))
	if err != nil || int64(len(data)) > size {
		return nil, false
	}
	return data, true
}

func (p *pictures) charge(src, embedded, fragment string) string {
	size := int64(len(embedded) + len(fragment))
	if size > p.budget {
		return src
	}
	p.budget -= size
	return embedded + fragment
}
