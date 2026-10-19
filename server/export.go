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

// the formats a note is exported in; a PDF is printed by the browser from the
// page the reader is on, because no engine that lays out HTML fits in here
const (
	exportMarkdown = "md"
	exportHTML     = "html"
)

// maxEmbeddedImages caps the bytes of pictures an exported page carries inside
// it, counted as written, once for every place a picture is shown. A picture
// past the cap keeps its relative address and shows only beside the note it
// came from.
const maxEmbeddedImages = 32 << 20

// exportRenderer renders a note for a file that leaves the app, the way
// `scrawl render` does: there is no route to map a link onto, so a relative
// link stays as written.
var exportRenderer = render.New(render.Options{Relative: true})

// apiExport answers with one note as a file to save: the source as it is
// stored, or a page that opens on its own with the note's pictures inside it.
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

	// exportPage refuses a note past what a render takes, so no more is read
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
	// the page carries its own script, which must never run on this origin
	h.Set("Content-Security-Policy", rawContentSecurityPolicy)
	h.Set("Cache-Control", pageCacheControl)
}

// exportPage renders a note into a page of its own, the one `scrawl render`
// writes, with every picture of the space it shows embedded.
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

// pictures turns the relative addresses of a note's pictures into data URLs,
// within a budget shared by the whole note. A picture read once is kept, and
// every place it is shown again is charged again: each one is another copy.
type pictures struct {
	notes  *store.Store
	dir    string
	budget int64
	done   map[string]string
}

func newPictures(notes *store.Store, dir string, budget int64) *pictures {
	return &pictures{notes: notes, dir: dir, budget: budget, done: map[string]string{}}
}

// embed rewrites the src of every img and the srcset of every source in a
// fragment render made, and leaves every other byte as it came.
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
		// Token lowercases the tag name in the buffer Raw points into
		raw := bytes.Clone(z.Raw())
		tok := z.Token()
		if !p.rewrite(&tok) {
			out.Write(raw)
			continue
		}
		out.WriteString(tok.String())
	}
}

// rewrite embeds the pictures one tag names and reports whether it changed it.
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

// srcset embeds every candidate of a srcset. A data URL holds no whitespace,
// so it stays one candidate: the browser reads a URL up to the next space.
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

// dataURL is the picture a relative address points at as a data URL, or the
// address as it was when it names no picture of the space or the budget is
// spent. An svg is embedded too: in an img it is a picture, never a document.
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
	// kept only once charged, so a picture refused is never held in memory
	if res != src {
		p.done[clean] = embedded
	}
	return res
}

// resolve is the content path a relative address names and its fragment, which
// picks the view of an svg that shows only a part of itself.
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

// read takes no more of a picture than the size the budget was checked
// against, so one that grew since is refused rather than read whole.
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

// charge spends the budget on one more copy of a picture, and answers with the
// address as it was when the copy does not fit, before the copy is made.
func (p *pictures) charge(src, embedded, fragment string) string {
	size := int64(len(embedded) + len(fragment))
	if size > p.budget {
		return src
	}
	p.budget -= size
	return embedded + fragment
}
