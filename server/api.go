package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/aleksey925/scrawl/auth"
	"github.com/aleksey925/scrawl/history"
	"github.com/aleksey925/scrawl/search"
	"github.com/aleksey925/scrawl/store"
	"github.com/aleksey925/scrawl/view"
)

const multipartOverhead = 1 << 20

type treeNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	IsDir    bool       `json:"is_dir"`
	Children []treeNode `json:"children,omitempty"`
}

type fileResponse struct {
	Path    string    `json:"path"`
	Content string    `json:"content"`
	Rev     string    `json:"rev"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"mod_time"`
}

type saveRequest struct {
	Content   string `json:"content"`
	Rev       string `json:"rev"`
	Formatted bool   `json:"formatted"`
}

type createRequest struct {
	Type string `json:"type"`
}

type moveRequest struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type previewRequest struct {
	Content string `json:"content"`
	Path    string `json:"path"`
}

type searchHit struct {
	Path    string  `json:"path"`
	Title   string  `json:"title"`
	Snippet string  `json:"snippet"`
	Score   float64 `json:"score"`
	URL     string  `json:"url"`
	*findHit
}

type findHit struct {
	TitleSpans []searchSpan `json:"title_spans,omitempty"`
	MatchCount int          `json:"match_count"`
	LineCount  int          `json:"line_count"`
	Lines      []searchLine `json:"lines"`
}

type searchSpan struct {
	Text string `json:"text"`
	Hit  bool   `json:"hit"`
}

type searchLine struct {
	Line  int          `json:"line"`
	URL   string       `json:"url"`
	Spans []searchSpan `json:"spans"`
}

func (m *mount) apiTree(w http.ResponseWriter, r *http.Request) {
	root, err := m.spc.Store.Tree()
	if err != nil {
		failJSON(w, r, err)
		return
	}
	dirsOnly := r.URL.Query().Get("dirs") == "1"
	writeJSON(w, http.StatusOK, map[string][]treeNode{"tree": jsonChildren(root, dirsOnly)})
}

func jsonChildren(node *store.Node, dirsOnly bool) []treeNode {
	res := make([]treeNode, 0, len(node.Children))
	for _, child := range node.Children {
		if !child.InNavTree() || (dirsOnly && !child.IsDir) {
			continue
		}
		res = append(res, treeNode{
			Name:     child.Name,
			Path:     child.Path,
			IsDir:    child.IsDir,
			Children: jsonChildren(child, dirsOnly),
		})
	}
	return res
}

func (m *mount) apiFileGet(w http.ResponseWriter, r *http.Request) {
	p, ok := contentPath(r, "path")
	if !ok || p == "" {
		jsonError(w, http.StatusBadRequest, "bad path")
		return
	}

	stat, err := m.spc.Store.Stat(p)
	if err != nil {
		failJSON(w, r, err)
		return
	}
	switch {
	case stat.IsDir:
		failJSON(w, r, store.ErrIsDir)
		return
	case !isTextFile(p):
		jsonError(w, http.StatusUnsupportedMediaType, "not a text file, read it from /raw/")
		return
	case stat.Size > maxEditableFile:
		jsonError(w, http.StatusRequestEntityTooLarge, "file is too large to edit, read it from /raw/")
		return
	}

	data, fi, err := m.spc.Store.Read(p)
	if err != nil {
		failJSON(w, r, err)
		return
	}
	if !textContent(data) {
		jsonError(w, http.StatusUnsupportedMediaType, "not text, read it from /raw/")
		return
	}
	writeJSON(w, http.StatusOK, fileResponse{
		Path:    fi.Path,
		Content: string(data),
		Rev:     store.Rev(data),
		Size:    fi.Size,
		ModTime: fi.ModTime,
	})
}

func (m *mount) apiFileSave(w http.ResponseWriter, r *http.Request) {
	if m.refuseReadOnly(w, r) {
		return
	}
	p, ok := contentPath(r, "path")
	if !ok || p == "" {
		jsonError(w, http.StatusBadRequest, "bad path")
		return
	}
	var req saveRequest
	if !decodeJSON(w, r, &req, maxJSONBody) {
		return
	}

	stored := saved{text: req.Content}
	if !req.Formatted {
		r = m.keepThrough(r, p)
		stored = m.formatOnSave(r, p, req.Content)
	}

	var fi store.FileInfo
	err := m.record(r, history.Op{Message: "save " + p, Paths: []string{p}}, func() ([]string, error) {
		var writeErr error
		fi, writeErr = m.spc.Store.Write(p, []byte(stored.text), req.Rev)
		return nil, writeErr
	})
	var conflict *store.ConflictError
	switch {
	case errors.As(err, &conflict):
		writeConflict(w, http.StatusPreconditionFailed, "conflict", conflict.CurrentRev, conflict.Current)
		return
	case errors.Is(err, store.ErrExists):
		current, _, readErr := m.spc.Store.Read(p)
		if readErr != nil {
			failJSON(w, r, err)
			return
		}
		writeConflict(w, http.StatusConflict, errMessage(err), store.Rev(current), current)
		return
	case err != nil:
		failJSON(w, r, err)
		return
	}

	m.touch(p)
	res := m.withHistory(map[string]any{"rev": store.Rev([]byte(stored.text)), "mod_time": fi.ModTime})
	writeJSON(w, http.StatusOK, stored.describe(res, req.Content))
}

func writeConflict(w http.ResponseWriter, status int, message, rev string, current []byte) {
	writeJSON(w, status, map[string]any{
		"error":           message,
		"current_rev":     rev,
		"current_content": string(current),
	})
}

func (m *mount) apiFileCreate(w http.ResponseWriter, r *http.Request) {
	if m.refuseReadOnly(w, r) {
		return
	}
	p, ok := contentPath(r, "path")
	if !ok || p == "" {
		jsonError(w, http.StatusBadRequest, "bad path")
		return
	}
	var req createRequest
	if !decodeJSON(w, r, &req, maxJSONBody) {
		return
	}
	if req.Type != "file" && req.Type != "dir" {
		jsonError(w, http.StatusBadRequest, `type must be "file" or "dir"`)
		return
	}

	var recorded []string
	if req.Type == "file" {
		recorded = []string{p}
	}
	var fi store.FileInfo
	err := m.record(r, history.Op{Message: "create " + p, Paths: recorded}, func() ([]string, error) {
		var createErr error
		fi, createErr = m.spc.Store.Create(p, req.Type == "dir")
		return nil, createErr
	})
	if err != nil {
		failJSON(w, r, err)
		return
	}
	m.touch(p)
	res := map[string]any{"path": fi.Path}
	if editable(fi) {
		res["edit_url"] = view.EditURL(fi.Path)
	}
	writeJSON(w, http.StatusCreated, m.withHistory(res))
}

func (m *mount) apiFileDelete(w http.ResponseWriter, r *http.Request) {
	if m.refuseReadOnly(w, r) {
		return
	}
	p, ok := contentPath(r, "path")
	if !ok || p == "" {
		jsonError(w, http.StatusBadRequest, "bad path")
		return
	}

	recursive := r.URL.Query().Get("recursive") == "true"

	var removed []string
	err := m.record(r, history.Op{Message: "delete " + p, Paths: []string{p}}, func() ([]string, error) {
		if !recursive {
			return nil, m.spc.Store.Remove(p)
		}
		removed = m.filesUnder(p)
		return removed, m.spc.Store.RemoveAll(p)
	})
	if err != nil {
		failJSON(w, r, err)
		return
	}
	m.touch(append(removed, p)...)
	writeJSON(w, http.StatusOK, m.withHistory(map[string]any{"path": p}))
}

func (m *mount) apiMove(w http.ResponseWriter, r *http.Request) {
	if m.refuseReadOnly(w, r) {
		return
	}
	var req moveRequest
	if !decodeJSON(w, r, &req, maxJSONBody) {
		return
	}
	if req.From == "" || req.To == "" {
		jsonError(w, http.StatusBadRequest, "both from and to are required")
		return
	}

	op := history.Op{Message: "move " + req.From + " to " + req.To, Paths: []string{req.From, req.To}}
	err := m.record(r, op, func() ([]string, error) {
		moved := m.movedPaths(req.From, req.To)
		return moved, m.spc.Store.Move(req.From, req.To)
	})
	if err != nil {
		failJSON(w, r, err)
		return
	}
	m.touch(req.From, req.To)
	writeJSON(w, http.StatusOK, m.withHistory(map[string]any{"path": req.To}))
}

func (m *mount) movedPaths(from, to string) []string {
	under := m.filesUnder(from)
	if len(under) == 0 {
		return nil
	}
	res := make([]string, 0, 2*len(under))
	for _, p := range under {
		res = append(res, p, to+strings.TrimPrefix(p, from))
	}
	return res
}

func (m *mount) filesUnder(dir string) []string {
	files, err := m.spc.Store.Files()
	if err != nil {
		return nil
	}
	prefix := dir + "/"
	res := []string{}
	for _, fi := range files {
		if strings.HasPrefix(fi.Path, prefix) {
			res = append(res, fi.Path)
		}
	}
	return res
}

func (m *mount) apiUpload(w http.ResponseWriter, r *http.Request) {
	if m.refuseReadOnly(w, r) {
		return
	}
	dir, ok := contentPath(r, "dir")
	if !ok {
		jsonError(w, http.StatusBadRequest, "bad path")
		return
	}
	doc, ok := contentPathOf(r.URL.Query().Get("doc"))
	if !ok {
		doc = ""
	}
	if m.MaxUpload > 0 {
		r.Body = http.MaxBytesReader(w, r.Body, m.MaxUpload+multipartOverhead)
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			jsonError(w, http.StatusRequestEntityTooLarge, "file is too large")
			return
		}
		jsonError(w, http.StatusBadRequest, "no file in the request")
		return
	}
	defer file.Close()

	var fi store.FileInfo
	err = m.record(r, history.Op{Message: "upload an attachment"}, func() ([]string, error) {
		var upErr error
		fi, upErr = m.spc.Store.Upload(m.uploadDir(doc, dir), header.Filename, file, m.MaxUpload)
		if upErr != nil {
			return nil, upErr
		}
		return []string{fi.Path}, nil
	})
	if err != nil {
		failJSON(w, r, err)
		return
	}
	m.touch(fi.Path)

	writeJSON(w, http.StatusCreated, m.withHistory(map[string]any{
		"path":     fi.Path,
		"markdown": "![](" + relativeLink(doc, fi.Path) + ")",
	}))
}

func (wb *Web) uploadDir(doc, requested string) string {
	if wb.UploadDir != "" {
		return wb.UploadDir
	}
	if doc == "" {
		return requested
	}
	name := path.Base(doc)
	return path.Join(path.Dir(doc), strings.TrimSuffix(name, path.Ext(name)))
}

func (m *mount) apiPreview(w http.ResponseWriter, r *http.Request) {
	var req previewRequest
	if !decodeJSON(w, r, &req, maxPreviewBody) {
		return
	}
	docPath, ok := contentPathOf(req.Path)
	if !ok {
		jsonError(w, http.StatusBadRequest, "bad path")
		return
	}

	source := []byte(req.Content)
	html, err := renderWithDeadline(docPath, source, maxPreviewBody, renderTimeout, func() (template.HTML, error) {
		return m.spc.Renderer.RenderInline(source, docPath)
	})
	if err != nil {
		failJSON(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"html": string(html)})
}

func (m *mount) apiSearch(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	find, extended, err := searchQueryOf(r.URL.Query())
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	limit := searchAPILimit
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			jsonError(w, http.StatusBadRequest, "limit must be a positive number")
			return
		}
		limit = min(parsed, searchPageLimit)
	}

	start := time.Now()
	if extended {
		m.findSearch(w, r, find, limit, start)
		return
	}
	hits := make([]searchHit, 0, limit)
	if query != "" && m.spc.Index != nil {
		for _, hit := range m.spc.Index.SearchPrefix(query, limit) {
			hits = append(hits, searchHit{
				Path:    hit.Path,
				Title:   hit.Title,
				Snippet: string(hit.Snippet),
				Score:   hit.Score,
				URL:     view.SearchURL(hit.Path, query),
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hits":       hits,
		"elapsed_ms": time.Since(start).Milliseconds(),
	})
}

func (m *mount) touch(paths ...string) {
	for _, p := range paths {
		m.pages().invalidate(m.spc.Name, p)
		if m.spc.Index == nil || !isMarkdown(p) {
			continue
		}
		data, _, err := m.spc.Store.Read(p)
		if err != nil {
			m.spc.Index.Delete(p)
			continue
		}
		m.spc.Index.Set(p, data)
	}
}

func (m *mount) refuseReadOnly(w http.ResponseWriter, r *http.Request) bool {
	switch {
	case m.ReadOnly:
		jsonError(w, http.StatusForbidden, errMessage(store.ErrReadOnly))
	case m.spc.ReadOnly:
		jsonError(w, http.StatusForbidden, "read-only space, writing is disabled")
	case auth.ReadOnlyToken(r):
		jsonError(w, http.StatusForbidden, "read-only token, writing is disabled")
	default:
		return false
	}
	return true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any, limit int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			jsonError(w, http.StatusRequestEntityTooLarge, "request body is too large")
			return false
		}
		jsonError(w, http.StatusBadRequest, "malformed json body")
		return false
	}
	return true
}

func contentPathOf(p string) (string, bool) {
	p = strings.Trim(p, "/")
	if strings.ContainsRune(p, 0) {
		return "", false
	}
	return p, true
}

func relativeLink(doc, target string) string {
	base := path.Dir(doc)
	if doc == "" || base == "." || base == "/" {
		return target
	}

	baseSegments, targetSegments := strings.Split(base, "/"), strings.Split(target, "/")
	shared := 0
	for shared < len(baseSegments) && shared < len(targetSegments)-1 &&
		baseSegments[shared] == targetSegments[shared] {
		shared++
	}

	res := make([]string, 0, len(baseSegments)-shared+len(targetSegments)-shared)
	for range len(baseSegments) - shared {
		res = append(res, "..")
	}
	return path.Join(append(res, targetSegments[shared:]...)...)
}

func searchQueryOf(values url.Values) (search.Query, bool, error) {
	q := search.Query{Text: values.Get("q"), Mode: search.ModeFuzzy}
	extended := false
	switch mode := values.Get("mode"); mode {
	case "":
	case string(search.ModeFuzzy), string(search.ModeExact):
		q.Mode, extended = search.Mode(mode), true
	default:
		return q, false, fmt.Errorf("mode must be %s or %s", search.ModeFuzzy, search.ModeExact)
	}
	for name, field := range map[string]*bool{"case": &q.Case, "word": &q.Word, "regex": &q.Regex, "titles": &q.TitlesOnly} {
		if values.Has(name) {
			*field, extended = values.Get(name) == "1", true
		}
	}
	if q.Mode == search.ModeFuzzy && !q.Regex {
		q.Text = strings.TrimSpace(q.Text)
	}
	return q, extended, nil
}

func (m *mount) findSearch(w http.ResponseWriter, r *http.Request, q search.Query, limit int, start time.Time) {
	found := search.Found{}
	if m.spc.Index != nil {
		ctx, cancel := context.WithTimeout(r.Context(), searchTimeout)
		defer cancel()
		var err error
		if found, err = m.spc.Index.Find(ctx, q, limit); err != nil {
			jsonError(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	hits := make([]searchHit, 0, len(found.Results))
	for _, res := range found.Results {
		find := view.Find(res.Find)
		lines := make([]searchLine, 0, len(res.Lines))
		for _, matched := range res.Lines {
			lines = append(lines, searchLine{Line: matched.Line, URL: view.FindURL(res.Path, find, matched.Line), Spans: spansOf(matched.Spans)})
		}
		hits = append(hits, searchHit{
			Path:    res.Path,
			Title:   res.Title,
			Snippet: string(res.Snippet),
			Score:   res.Score,
			URL:     view.FindURL(res.Path, find, 0),
			findHit: &findHit{
				TitleSpans: spansOf(res.TitleSpans),
				MatchCount: res.MatchCount,
				LineCount:  res.LineCount,
				Lines:      lines,
			},
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hits":       hits,
		"elapsed_ms": time.Since(start).Milliseconds(),
		"truncated":  found.Truncated,
	})
}

func spansOf(spans []search.Span) []searchSpan {
	res := make([]searchSpan, 0, len(spans))
	for _, piece := range spans {
		res = append(res, searchSpan{Text: piece.Text, Hit: piece.Hit})
	}
	return res
}
