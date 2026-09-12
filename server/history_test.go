package server

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/history"
	"github.com/aleksey925/scrawl/store"
)

// testOID is what an object id looks like to the handlers, which pass it
// through without reading it.
var testOID = strings.Repeat("a1b2c3d4", 5)

// fakeHistory stands in for the git-backed service: it keeps every operation
// the handlers hand it and can be made to fail a commit on demand.
type fakeHistory struct {
	degraded bool
	failWith error // what the commit answers once the mutation has already run
	entries  []history.Entry
	content  []byte
	diff     string
	readErr  error

	ops      []history.Op
	reported [][]string
}

func (f *fakeHistory) Enabled() bool  { return true }
func (f *fakeHistory) Degraded() bool { return f.degraded }

func (f *fakeHistory) Record(_ context.Context, op history.Op, mutate func() ([]string, error)) error {
	paths, err := mutate()
	if err != nil {
		return err
	}
	f.ops = append(f.ops, op)
	f.reported = append(f.reported, paths)
	if f.failWith == nil {
		return nil
	}
	f.degraded = true
	if op.Strict {
		return f.failWith
	}
	return nil
}

func (f *fakeHistory) Log(context.Context, string, int) ([]history.Entry, error) {
	return f.entries, f.readErr
}

func (f *fakeHistory) Show(context.Context, string) ([]byte, error) { return f.content, f.readErr }

func (f *fakeHistory) Diff(context.Context, string, string) (string, error) {
	return f.diff, f.readErr
}

func (f *fakeHistory) messages() []string {
	res := make([]string, 0, len(f.ops))
	for _, op := range f.ops {
		res = append(res, op.Message)
	}
	return res
}

func (f *fakeHistory) given() [][]string {
	res := make([][]string, 0, len(f.ops))
	for _, op := range f.ops {
		res = append(res, op.Paths)
	}
	return res
}

func TestAPIHistoryList(t *testing.T) {
	// arrange
	entry := history.Entry{
		Rev: testOID, Short: testOID[:7], Blob: strings.Repeat("f0f0f0f0", 5),
		Actor: "token:agent", Message: "save index.md", Path: "index.md",
		Kind: history.KindModified, At: time.Date(2024, time.March, 1, 10, 30, 0, 0, time.UTC),
	}
	ts := newTestServer(t, testOpts{history: &fakeHistory{degraded: true, entries: []history.Entry{entry}}})

	// act
	resp, body := ts.json(t, request{path: "/api/history/index.md"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, map[string]any{
		"path":     "index.md",
		"degraded": true,
		"entries": []any{map[string]any{
			"rev":     entry.Rev,
			"short":   entry.Short,
			"blob":    entry.Blob,
			"actor":   entry.Actor,
			"message": entry.Message,
			"path":    entry.Path,
			"kind":    string(entry.Kind),
			"at":      entry.At.Format(time.RFC3339),
		}},
	}, body)
}

func TestAPIHistoryVersion(t *testing.T) {
	fake := &fakeHistory{content: []byte("# the old one\n"), diff: "diff --git a/index.md b/index.md\n+the old one\n"}
	ts := newTestServer(t, testOpts{history: fake})

	t.Run("carries the content and the patch of a text document", func(t *testing.T) {
		// act
		resp, body := ts.json(t, request{path: "/api/history/index.md?rev=" + testOID + "&blob=" + testOID})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.Equal(t, map[string]any{
			"path":    "index.md",
			"rev":     testOID,
			"blob":    testOID,
			"text":    true,
			"content": string(fake.content),
			"diff":    fake.diff,
		}, body)
	})

	t.Run("leaves out the content of an attachment", func(t *testing.T) {
		// act
		resp, body := ts.json(t, request{path: "/api/history/images/logo.png?rev=" + testOID + "&blob=" + testOID})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.Equal(t, map[string]any{
			"path": "images/logo.png",
			"rev":  testOID,
			"blob": testOID,
			"text": false,
			"diff": fake.diff,
		}, body)
	})

	t.Run("leaves out the content of a deletion, which has no blob", func(t *testing.T) {
		// act
		resp, body := ts.json(t, request{path: "/api/history/index.md?rev=" + testOID})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.NotContains(t, body, "content")
	})

	t.Run("reports a repository that cannot be read", func(t *testing.T) {
		// arrange
		broken := newTestServer(t, testOpts{history: &fakeHistory{readErr: errors.New("git exploded")}})

		// act
		resp, body := broken.json(t, request{path: "/api/history/index.md?rev=" + testOID})

		// assert
		assert.Equal(t, http.StatusInternalServerError, resp.status)
		assert.Equal(t, "history is unavailable", body["error"])
	})
}

func TestAPIHistoryRestore(t *testing.T) {
	restored := []byte("# the old one\n")

	t.Run("writes the old version back through the store", func(t *testing.T) {
		// arrange
		fake := &fakeHistory{content: restored}
		ts := newTestServer(t, testOpts{history: fake})
		_, current := ts.json(t, request{path: "/api/file/index.md"})

		// act
		resp, body := ts.json(t, request{
			method: http.MethodPost,
			path:   "/api/history/restore/index.md",
			body:   jsonBody(t, map[string]string{"blob": testOID, "rev": current["rev"].(string)}),
		})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.Equal(t, "index.md", body["path"])
		assert.Equal(t, store.Rev(restored), body["rev"])
		assert.Equal(t, false, body["history_degraded"])

		onDisk, err := os.ReadFile(filepath.Join(ts.root, "index.md"))
		require.NoError(t, err)
		assert.Equal(t, restored, onDisk)
		assert.Equal(t, []history.Op{{Actor: "anonymous", Message: "restore index.md", Paths: []string{"index.md"}}},
			fake.ops)
	})

	t.Run("refuses a revision that is no longer the one on disk", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{history: &fakeHistory{content: restored}})
		_, current := ts.json(t, request{path: "/api/file/index.md"})

		// act
		resp, body := ts.json(t, request{
			method: http.MethodPost,
			path:   "/api/history/restore/index.md",
			body:   jsonBody(t, map[string]string{"blob": testOID, "rev": "written-by-somebody-else"}),
		})

		// assert
		assert.Equal(t, http.StatusPreconditionFailed, resp.status)
		assert.Equal(t, "conflict", body["error"])
		assert.Equal(t, current["rev"], body["current_rev"])
		assert.Equal(t, current["content"], body["current_content"])
	})

	t.Run("is refused in read-only mode", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{readOnly: true, history: &fakeHistory{content: restored}})

		// act
		resp, body := ts.json(t, request{
			method: http.MethodPost,
			path:   "/api/history/restore/index.md",
			body:   jsonBody(t, map[string]string{"blob": testOID, "rev": ""}),
		})

		// assert
		assert.Equal(t, http.StatusForbidden, resp.status)
		assert.Equal(t, "read-only mode, writing is disabled", body["error"])
	})

	t.Run("is refused for a read-only token", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{withAuth: true, history: &fakeHistory{content: restored}})

		// act
		resp, body := ts.json(t, request{
			method:  http.MethodPost,
			path:    "/api/history/restore/index.md",
			body:    jsonBody(t, map[string]string{"blob": testOID, "rev": ""}),
			headers: map[string]string{"Authorization": "Bearer " + testReadToken},
		})

		// assert
		assert.Equal(t, http.StatusForbidden, resp.status)
		assert.Equal(t, "read-only token, writing is disabled", body["error"])
	})
}

func TestAPIHistoryWithoutTheService(t *testing.T) {
	ts := newTestServer(t, testOpts{})

	tests := []struct {
		name   string
		method string
		path   string
	}{
		{name: "list", path: "/api/history/index.md"},
		{name: "one version", path: "/api/history/index.md?rev=" + testOID},
		{name: "restore", method: http.MethodPost, path: "/api/history/restore/index.md"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, body := ts.json(t, request{
				method: tc.method,
				path:   tc.path,
				body:   jsonBody(t, map[string]string{"blob": testOID, "rev": ""}),
			})

			// assert
			assert.Equal(t, http.StatusServiceUnavailable, resp.status)
			assert.Equal(t, "history is disabled", body["error"])
		})
	}
}

func TestHistoryPage(t *testing.T) {
	at := time.Date(2024, time.March, 1, 10, 30, 0, 0, time.UTC)
	entries := []history.Entry{
		{
			Rev: testOID, Short: testOID[:7], Blob: strings.Repeat("f0f0f0f0", 5),
			Actor: "token:agent", Message: "save index.md", Path: "index.md",
			Kind: history.KindModified, At: at,
		},
		{
			Rev: strings.Repeat("b1b2b3b4", 5), Short: "b1b2b3b", Blob: strings.Repeat("c4c4c4c4", 5),
			Actor: "bob", Message: "move home.md to index.md", Path: "home.md",
			Kind: history.KindRenamed, At: at.Add(-time.Hour),
		},
		{
			Rev: strings.Repeat("d5d5d5d5", 5), Short: "d5d5d5d", Blob: "",
			Actor: "external", Message: "delete home.md", Path: "home.md",
			Kind: history.KindDeleted, At: at.Add(-2 * time.Hour),
		},
	}

	t.Run("lists every version and offers a restore for the ones with content", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{history: &fakeHistory{entries: entries}})

		// act
		resp, body := ts.do(t, request{path: "/history/index.md"})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.Contains(t, body, "save index.md")
		assert.Contains(t, body, "move home.md to index.md")
		assert.Contains(t, body, "delete home.md")
		assert.Contains(t, body, "is-renamed")
		assert.Contains(t, body, "is-deleted")
		assert.Contains(t, body, "home.md", "a rename kept the path the document had back then")
		assert.Equal(t, 2, strings.Count(body, "data-restore"),
			"a deletion carries no content to restore")
	})

	t.Run("offers no restore in read-only mode", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{readOnly: true, history: &fakeHistory{entries: entries}})

		// act
		resp, body := ts.do(t, request{path: "/history/index.md"})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.Contains(t, body, "save index.md")
		assert.NotContains(t, body, "data-restore")
		assert.NotContains(t, body, "data-can-restore")
	})

	t.Run("says on the page that history fell behind the disk", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{history: &fakeHistory{degraded: true, entries: entries}})

		// act
		_, body := ts.do(t, request{path: "/history/index.md"})

		// assert
		assert.Contains(t, body, "history-warn")
		assert.Contains(t, body, "was not recorded")
	})

	t.Run("takes a document that is not on disk, which is what a deletion leaves", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{history: &fakeHistory{entries: entries}})

		// act
		resp, body := ts.do(t, request{path: "/history/gone.md"})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.Contains(t, body, "data-can-restore", "restoring it back is the point")
		assert.Contains(t, body, `data-rev=""`)
	})

	t.Run("says there is nothing yet for a document history never saw", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{history: &fakeHistory{}})

		// act
		resp, body := ts.do(t, request{path: "/history/index.md"})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.Contains(t, body, "No versions recorded yet")
	})

	t.Run("is not a page at all with history off", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{})

		// act
		resp, body := ts.do(t, request{path: "/history/index.md"})

		// assert
		assert.Equal(t, http.StatusNotFound, resp.status)
		assert.Contains(t, body, "error-code")
	})

	t.Run("reports a repository that cannot be read", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{history: &fakeHistory{readErr: errors.New("git exploded")}})

		// act
		resp, _ := ts.do(t, request{path: "/history/index.md"})

		// assert
		assert.Equal(t, http.StatusInternalServerError, resp.status)
	})
}

func TestTheHistoryActionIsOnlyThereWhenHistoryIs(t *testing.T) {
	// arrange
	on := newTestServer(t, testOpts{history: &fakeHistory{}})
	off := newTestServer(t, testOpts{})

	// act
	_, withHistory := on.do(t, request{path: "/p/index.md"})
	_, without := off.do(t, request{path: "/p/index.md"})

	// assert
	assert.Contains(t, withHistory, `href="/history/index.md"`)
	assert.NotContains(t, without, "/history/")
}

func TestEveryMutationIsRecorded(t *testing.T) {
	// arrange
	fake := &fakeHistory{}
	ts := newTestServer(t, testOpts{history: fake})
	upload, contentType := multipartFile(t, "file", "shot.png", tinyPNG(t))

	// act
	calls := []request{
		{method: http.MethodPut, path: "/api/file/fresh.md", body: jsonBody(t, saveRequest{Content: "# fresh\n"})},
		{method: http.MethodPost, path: "/api/file/folder", body: jsonBody(t, createRequest{Type: "dir"})},
		{method: http.MethodPost, path: "/api/file/new.md", body: jsonBody(t, createRequest{Type: "file"})},
		{method: http.MethodDelete, path: "/api/file/new.md"},
		{method: http.MethodPost, path: "/api/move", body: jsonBody(t, moveRequest{From: "fresh.md", To: "moved.md"})},
		{method: http.MethodPost, path: "/api/upload/images", body: upload,
			headers: map[string]string{"Content-Type": contentType}},
	}
	for _, call := range calls {
		resp, body := ts.json(t, call)
		require.Less(t, resp.status, http.StatusMultipleChoices, "%s %s: %v", call.method, call.path, body)
	}

	// assert
	assert.Equal(t, []string{
		"save fresh.md", "create folder", "create new.md", "delete new.md",
		"move fresh.md to moved.md", "upload an attachment",
	}, fake.messages())
	assert.Equal(t, [][]string{
		{"fresh.md"}, nil, {"new.md"}, {"new.md"}, {"fresh.md", "moved.md"}, nil,
	}, fake.given())
	assert.Equal(t, [][]string{nil, nil, nil, nil, nil, {"images/shot.png"}}, fake.reported,
		"only the upload learns its path from the store")
}

func TestMoveRecordsTheDocumentsUnderADirectory(t *testing.T) {
	// arrange
	fake := &fakeHistory{}
	ts := newTestServer(t, testOpts{history: fake})

	// act
	resp, body := ts.json(t, request{
		method: http.MethodPost, path: "/api/move",
		body: jsonBody(t, moveRequest{From: "docs", To: "manuals"}),
	})

	// assert
	require.Equal(t, http.StatusOK, resp.status, body)
	assert.Equal(t, [][]string{{"docs", "manuals"}}, fake.given(),
		"a directory carries no extension worth versioning, so naming it records nothing")
	assert.Equal(t, [][]string{{
		"docs/README.md", "manuals/README.md",
		"docs/page.md", "manuals/page.md",
		"docs/sub/deep.md", "manuals/sub/deep.md",
	}}, fake.reported)
}

func TestRecordNamesTheActorAndIsStrictOnlyForAToken(t *testing.T) {
	// arrange
	fake := &fakeHistory{}
	ts := newTestServer(t, testOpts{withAuth: true, history: fake})

	// act
	resp, body := ts.json(t, request{
		method: http.MethodPut, path: "/api/file/browser.md",
		body: jsonBody(t, saveRequest{Content: "# browser\n"}), client: ts.login(t),
	})
	require.Equal(t, http.StatusOK, resp.status, body)

	resp, body = ts.json(t, request{
		method: http.MethodPut, path: "/api/file/agent.md",
		body:    jsonBody(t, saveRequest{Content: "# agent\n"}),
		headers: map[string]string{"Authorization": "Bearer " + testToken},
	})
	require.Equal(t, http.StatusOK, resp.status, body)

	// assert
	assert.Equal(t, []history.Op{
		{Actor: testUser, Message: "save browser.md", Paths: []string{"browser.md"}},
		{Actor: "token:agent", Message: "save agent.md", Paths: []string{"agent.md"}, Strict: true},
	}, fake.ops)
}

func TestAWriteHistoryCouldNotRecord(t *testing.T) {
	// arrange
	fake := &fakeHistory{failWith: errors.New("the index is locked")}
	ts := newTestServer(t, testOpts{withAuth: true, history: fake})

	// act
	agent, agentBody := ts.json(t, request{
		method: http.MethodPut, path: "/api/file/agent.md",
		body:    jsonBody(t, saveRequest{Content: "# agent\n"}),
		headers: map[string]string{"Authorization": "Bearer " + testToken},
	})
	browser, browserBody := ts.json(t, request{
		method: http.MethodPut, path: "/api/file/browser.md",
		body: jsonBody(t, saveRequest{Content: "# browser\n"}), client: ts.login(t),
	})

	// assert
	assert.Equal(t, http.StatusInternalServerError, agent.status)
	assert.Equal(t, "the change was written but not recorded in history", agentBody["error"])
	assert.FileExists(t, filepath.Join(ts.root, "agent.md"), "the write itself still happened")

	assert.Equal(t, http.StatusOK, browser.status)
	assert.Equal(t, true, browserBody["history_degraded"])
}

func TestAStoreFailureIsNeverReadAsAHistoryOne(t *testing.T) {
	// arrange
	fake := &fakeHistory{failWith: errors.New("the index is locked")}
	ts := newTestServer(t, testOpts{withAuth: true, history: fake})

	// act
	resp, body := ts.json(t, request{
		method: http.MethodPut, path: "/api/file/index.md",
		body:    jsonBody(t, saveRequest{Content: "# mine\n", Rev: "stale"}),
		headers: map[string]string{"Authorization": "Bearer " + testToken},
	})

	// assert
	assert.Equal(t, http.StatusPreconditionFailed, resp.status)
	assert.Equal(t, "conflict", body["error"])
	assert.Empty(t, fake.ops, "a mutation that failed is never recorded")
}
