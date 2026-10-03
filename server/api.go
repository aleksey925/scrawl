package server

import (
	"encoding/json"
	"errors"
	"html/template"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/aleksey925/scrawl/auth"
	"github.com/aleksey925/scrawl/history"
	"github.com/aleksey925/scrawl/store"
)

// multipartOverhead is the room an upload gets on top of the file itself for
// the multipart headers and boundaries.
const multipartOverhead = 1 << 20

// treeNode is one node of the sidebar tree as the JSON API spells it.
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
	Content string `json:"content"`
	Rev     string `json:"rev"`
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
}

// apiTree serves the sidebar tree, which the frontend reloads after every
// create, rename and delete.
// dirs=1 leaves the documents out, which is what the destination picker asks
// for: on a large corpus the files are the bulk of the tree and it lists none
// of them.
func (m *mount) apiTree(w http.ResponseWriter, r *http.Request) {
	root, err := m.prj.Store.Tree()
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
		if !inNavTree(child) || (dirsOnly && !child.IsDir) {
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

// apiFileGet returns the source of one file, which is what the editor loads.
//
// The whole file is read into memory and then JSON-escaped, which costs several
// times its size in RSS, so the size is checked before a single byte is read
// and only text is served at all. Anything else is an attachment and streams
// through /raw/ without ever being buffered.
func (m *mount) apiFileGet(w http.ResponseWriter, r *http.Request) {
	p, ok := contentPath(r, "path")
	if !ok || p == "" {
		jsonError(w, http.StatusBadRequest, "bad path")
		return
	}

	stat, err := m.prj.Store.Stat(p)
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

	data, fi, err := m.prj.Store.Read(p)
	if err != nil {
		failJSON(w, r, err)
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

// apiFileSave writes a file, refusing the write when the revision the editor
// loaded is no longer the one on disk.
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

	var fi store.FileInfo
	err := m.record(r, history.Op{Message: "save " + p, Paths: []string{p}}, func() ([]string, error) {
		var writeErr error
		fi, writeErr = m.prj.Store.Write(p, []byte(req.Content), req.Rev)
		return nil, writeErr
	})
	var conflict *store.ConflictError
	switch {
	case errors.As(err, &conflict):
		writeConflict(w, http.StatusPreconditionFailed, "conflict", conflict.CurrentRev, conflict.Current)
		return
	case errors.Is(err, store.ErrExists):
		// an empty revision means "create", and the file turning out to be
		// there is the same collision seen from the editor: its dialog offers
		// an overwrite, which needs the revision and the content on disk
		current, _, readErr := m.prj.Store.Read(p)
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
	writeJSON(w, http.StatusOK, m.withHistory(map[string]any{
		"rev": store.Rev([]byte(req.Content)), "mod_time": fi.ModTime,
	}))
}

// writeConflict answers a save that collided with the file on disk. Both
// statuses carry the same fields, because the editor treats them the same way.
func writeConflict(w http.ResponseWriter, status int, message, rev string, current []byte) {
	writeJSON(w, status, map[string]any{
		"error":           message,
		"current_rev":     rev,
		"current_content": string(current),
	})
}

// apiFileCreate makes an empty file or a directory.
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

	// only a file has content worth recording, and a new directory is empty
	// anyway: naming one would be a pathspec over everything below it
	var recorded []string
	if req.Type == "file" {
		recorded = []string{p}
	}
	var fi store.FileInfo
	err := m.record(r, history.Op{Message: "create " + p, Paths: recorded}, func() ([]string, error) {
		var createErr error
		fi, createErr = m.prj.Store.Create(p, req.Type == "dir")
		return nil, createErr
	})
	if err != nil {
		failJSON(w, r, err)
		return
	}
	m.touch(p)
	writeJSON(w, http.StatusCreated, m.withHistory(map[string]any{"path": fi.Path}))
}

// apiFileDelete removes a file or an empty directory.
func (m *mount) apiFileDelete(w http.ResponseWriter, r *http.Request) {
	if m.refuseReadOnly(w, r) {
		return
	}
	p, ok := contentPath(r, "path")
	if !ok || p == "" {
		jsonError(w, http.StatusBadRequest, "bad path")
		return
	}

	err := m.record(r, history.Op{Message: "delete " + p, Paths: []string{p}}, func() ([]string, error) {
		return nil, m.prj.Store.Remove(p)
	})
	if err != nil {
		failJSON(w, r, err)
		return
	}
	m.touch(p)
	// 200 with a body rather than 204: every other mutation carries the state
	// of the change it made, and a deletion that never left the container is
	// the worst one to lose silently
	writeJSON(w, http.StatusOK, m.withHistory(map[string]any{"path": p}))
}

// apiMove renames or moves an entry.
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
		return moved, m.prj.Store.Move(req.From, req.To)
	})
	if err != nil {
		failJSON(w, r, err)
		return
	}
	m.touch(req.From, req.To)
	writeJSON(w, http.StatusOK, m.withHistory(map[string]any{"path": req.To}))
}

// movedPaths lists the documents a move carries with it. A file names itself in
// Op.Paths, but a directory has no extension worth versioning, so moving one
// would record nothing at all unless the files under it are named too. The list
// has to be read before the move, while the old paths still exist.
//
// A failure here is not worth refusing the move over: the change still reaches
// history through the reconcile the watcher runs, only as an external one.
func (m *mount) movedPaths(from, to string) []string {
	files, err := m.prj.Store.Files()
	if err != nil {
		return nil
	}
	prefix := from + "/"
	res := make([]string, 0, len(files))
	for _, fi := range files {
		if !strings.HasPrefix(fi.Path, prefix) {
			continue
		}
		res = append(res, fi.Path, to+"/"+strings.TrimPrefix(fi.Path, prefix))
	}
	if len(res) == 0 {
		// moving a file names itself in Op.Paths, so there is nothing to add
		return nil
	}
	return res
}

// apiUpload stores an attachment and answers with a markdown link relative to
// the document being edited, which arrives in the doc query parameter.
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
		fi, upErr = m.prj.Store.Upload(m.uploadDir(doc, dir), header.Filename, file, m.MaxUpload)
		if upErr != nil {
			return nil, upErr
		}
		// the store picks a free name inside the directory, so the path to
		// record exists only once the file itself does
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

// uploadDir decides where an attachment lands. By default it is the corpus
// convention: a folder next to the document and named after it, so that
// python/notes.md keeps its images in python/notes/. Config.UploadDir replaces
// that with one shared directory for everything, and the directory from the
// request is only used when no document was named.
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

// apiPreview renders the editor buffer through the pipeline that renders the
// view page, so what the writer sees is what the saved page will be.
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
		return m.prj.Renderer.RenderInline(source, docPath)
	})
	if err != nil {
		failJSON(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"html": string(html)})
}

// apiSearch backs the command palette.
func (m *mount) apiSearch(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
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
	hits := make([]searchHit, 0, limit)
	if query != "" && m.prj.Index != nil {
		for _, hit := range m.prj.Index.SearchPrefix(query, limit) {
			hits = append(hits, searchHit{
				Path:    hit.Path,
				Title:   hit.Title,
				Snippet: string(hit.Snippet),
				Score:   hit.Score,
				URL:     searchURL(hit.Path, query),
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hits":       hits,
		"elapsed_ms": time.Since(start).Milliseconds(),
	})
}

// touch refreshes what the server keeps about a path right after the app
// itself changed it. The watcher reports the same change a moment later, this
// only closes the window in which a reload would still show the old page.
func (m *mount) touch(paths ...string) {
	for _, p := range paths {
		m.pages().invalidate(m.prj.Name, p)
		if m.prj.Index == nil || !isMarkdown(p) {
			continue
		}
		data, _, err := m.prj.Store.Read(p)
		if err != nil {
			m.prj.Index.Delete(p)
			continue
		}
		m.prj.Index.Set(p, data)
	}
}

// refuseReadOnly guards every write endpoint against the three ways writing can
// be off: the whole server, this project, or the token the caller presented.
// Each gets its own message, otherwise an agent holding a read-only token
// cannot tell whether asking for a wider one would help, and a reader on a
// read-only project cannot tell it from a server that refuses everything.
func (m *mount) refuseReadOnly(w http.ResponseWriter, r *http.Request) bool {
	switch {
	case m.ReadOnly:
		jsonError(w, http.StatusForbidden, errMessage(store.ErrReadOnly))
	case m.prj.ReadOnly:
		jsonError(w, http.StatusForbidden, "read-only project, writing is disabled")
	case auth.ReadOnlyToken(r):
		jsonError(w, http.StatusForbidden, "read-only token, writing is disabled")
	default:
		return false
	}
	return true
}

// decodeJSON reads a JSON body capped at limit and reports whether the handler
// may go on. It answers the request itself when it cannot.
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

// contentPathOf validates a content path that arrived in a body or a query
// parameter instead of in the URL path.
func contentPathOf(p string) (string, bool) {
	p = strings.Trim(p, "/")
	if strings.ContainsRune(p, 0) {
		return "", false
	}
	return p, true
}

// relativeLink writes the markdown target from the document being edited to an
// uploaded file, so the link keeps working wherever the document is read from.
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
