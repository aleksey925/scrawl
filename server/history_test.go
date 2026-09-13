package server

import (
	"bytes"
	"context"
	"errors"
	"fmt"
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

// oid spells one of the object ids the handlers pass around. They compare them
// and never read them, so a repeated pair is as good as a real digest.
func oid(pair string) string { return strings.Repeat(pair, 20) }

// fakeHistory stands in for the git-backed service: it keeps every operation
// the handlers hand it, answers reads from the versions it was given, and can
// be made to fail a commit on demand.
type fakeHistory struct {
	degraded bool
	failWith error // what the commit answers once the mutation has already run
	entries  []history.Entry
	blobs    map[string][]byte // content of every blob the entries name
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

// Version resolves the pair the way the real service does: only a commit that
// changed that very path recorded a version of it.
func (f *fakeHistory) Version(_ context.Context, rev, p string) (string, error) {
	if f.readErr != nil {
		return "", f.readErr
	}
	for _, ent := range f.entries {
		if ent.Rev == rev && ent.Path == p {
			return ent.Blob, nil
		}
	}
	return "", history.ErrNoVersion
}

func (f *fakeHistory) Show(_ context.Context, blob string) ([]byte, error) {
	if f.readErr != nil {
		return nil, f.readErr
	}
	data, ok := f.blobs[blob]
	if !ok {
		return nil, fmt.Errorf("no blob %s", blob)
	}
	return data, nil
}

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
		Rev: oid("a1"), Short: oid("a1")[:7], Blob: oid("b2"),
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
	saved := []byte("# the old one\n")
	version := history.Entry{Rev: oid("a1"), Blob: oid("b2"), Path: "index.md", Kind: history.KindModified}
	deletion := history.Entry{Rev: oid("c3"), Path: "index.md", Kind: history.KindDeleted}
	fake := &fakeHistory{
		entries: []history.Entry{version, deletion},
		blobs:   map[string][]byte{version.Blob: saved},
		diff:    "diff --git a/index.md b/index.md\n+the old one\n",
	}
	ts := newTestServer(t, testOpts{history: fake})

	t.Run("carries the content and the patch of the version", func(t *testing.T) {
		// act
		resp, body := ts.json(t, request{path: "/api/history/index.md?rev=" + version.Rev})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.Equal(t, map[string]any{
			"path":    version.Path,
			"rev":     version.Rev,
			"content": string(saved),
			"diff":    fake.diff,
		}, body)
	})

	t.Run("leaves out the content of a deletion, which recorded none", func(t *testing.T) {
		// act
		resp, body := ts.json(t, request{path: "/api/history/index.md?rev=" + deletion.Rev})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.NotContains(t, body, "content")
	})

	t.Run("reads the version of the pair and not a blob the query names", func(t *testing.T) {
		// arrange
		secret := history.Entry{Rev: oid("d4"), Blob: oid("e5"), Path: "guide.md", Kind: history.KindModified}
		leaky := &fakeHistory{
			entries: []history.Entry{version, secret},
			blobs:   map[string][]byte{version.Blob: saved, secret.Blob: []byte("TOKEN=abc123\n")},
		}
		other := newTestServer(t, testOpts{history: leaky})

		// act
		resp, body := other.json(t, request{
			path: "/api/history/index.md?rev=" + version.Rev + "&blob=" + secret.Blob,
		})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.Equal(t, string(saved), body["content"])
	})

	t.Run("refuses a revision that never touched the path", func(t *testing.T) {
		// act
		resp, body := ts.json(t, request{path: "/api/history/guide.md?rev=" + version.Rev})

		// assert
		assert.Equal(t, http.StatusNotFound, resp.status)
		assert.Equal(t, "no such version", body["error"])
	})

	t.Run("reports a repository that cannot be read", func(t *testing.T) {
		// arrange
		broken := newTestServer(t, testOpts{history: &fakeHistory{readErr: errors.New("git exploded")}})

		// act
		resp, body := broken.json(t, request{path: "/api/history/index.md?rev=" + version.Rev})

		// assert
		assert.Equal(t, http.StatusInternalServerError, resp.status)
		assert.Equal(t, "history is unavailable", body["error"])
	})
}

func TestAPIHistoryRestore(t *testing.T) {
	restored := []byte("# the old one\n")
	version := history.Entry{Rev: oid("a1"), Blob: oid("b2"), Path: "index.md", Kind: history.KindModified}
	newFake := func() *fakeHistory {
		return &fakeHistory{entries: []history.Entry{version}, blobs: map[string][]byte{version.Blob: restored}}
	}

	t.Run("writes the old version back through the store", func(t *testing.T) {
		// arrange
		fake := newFake()
		ts := newTestServer(t, testOpts{history: fake})
		_, current := ts.json(t, request{path: "/api/file/index.md"})

		// act
		resp, body := ts.json(t, request{
			method: http.MethodPost,
			path:   "/api/history/restore/index.md",
			body: jsonBody(t, restoreRequest{
				Rev: current["rev"].(string), Version: version.Rev, From: version.Path,
			}),
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

	t.Run("takes the version of the pair and not a blob the body names", func(t *testing.T) {
		// arrange
		fake := newFake()
		secret := oid("e5")
		fake.blobs[secret] = []byte("TOKEN=abc123\n")
		ts := newTestServer(t, testOpts{history: fake})
		_, current := ts.json(t, request{path: "/api/file/index.md"})

		// act
		resp, body := ts.json(t, request{
			method: http.MethodPost,
			path:   "/api/history/restore/index.md",
			body: jsonBody(t, map[string]string{
				"rev": current["rev"].(string), "version": version.Rev, "from": version.Path, "blob": secret,
			}),
		})

		// assert
		require.Equal(t, http.StatusOK, resp.status, body)
		onDisk, err := os.ReadFile(filepath.Join(ts.root, "index.md"))
		require.NoError(t, err)
		assert.Equal(t, restored, onDisk)
	})

	t.Run("refuses a version that does not belong to the path", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{history: newFake()})
		_, current := ts.json(t, request{path: "/api/file/index.md"})

		// act
		resp, body := ts.json(t, request{
			method: http.MethodPost,
			path:   "/api/history/restore/index.md",
			body: jsonBody(t, restoreRequest{
				Rev: current["rev"].(string), Version: oid("9f"), From: version.Path,
			}),
		})

		// assert
		assert.Equal(t, http.StatusNotFound, resp.status)
		assert.Equal(t, "no such version", body["error"])
		onDisk, err := os.ReadFile(filepath.Join(ts.root, "index.md"))
		require.NoError(t, err)
		assert.Equal(t, current["content"], string(onDisk))
	})

	t.Run("refuses a version larger than a save would take", func(t *testing.T) {
		// arrange
		huge := history.Entry{Rev: oid("f0"), Blob: oid("0e"), Path: "index.md", Kind: history.KindModified}
		fake := newFake()
		fake.entries = append(fake.entries, huge)
		fake.blobs[huge.Blob] = bytes.Repeat([]byte("a"), maxEditableFile+1)
		ts := newTestServer(t, testOpts{history: fake})
		_, current := ts.json(t, request{path: "/api/file/index.md"})

		// act
		resp, body := ts.json(t, request{
			method: http.MethodPost,
			path:   "/api/history/restore/index.md",
			body: jsonBody(t, restoreRequest{
				Rev: current["rev"].(string), Version: huge.Rev, From: huge.Path,
			}),
		})

		// assert
		assert.Equal(t, http.StatusRequestEntityTooLarge, resp.status)
		assert.Equal(t, "file is too large", body["error"])
		onDisk, err := os.ReadFile(filepath.Join(ts.root, "index.md"))
		require.NoError(t, err)
		assert.Equal(t, current["content"], string(onDisk))
	})

	t.Run("refuses a revision that is no longer the one on disk", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{history: newFake()})
		_, current := ts.json(t, request{path: "/api/file/index.md"})

		// act
		resp, body := ts.json(t, request{
			method: http.MethodPost,
			path:   "/api/history/restore/index.md",
			body: jsonBody(t, restoreRequest{
				Rev: "written-by-somebody-else", Version: version.Rev, From: version.Path,
			}),
		})

		// assert
		assert.Equal(t, http.StatusPreconditionFailed, resp.status)
		assert.Equal(t, "conflict", body["error"])
		assert.Equal(t, current["rev"], body["current_rev"])
		assert.Equal(t, current["content"], body["current_content"])
	})

	t.Run("is refused in read-only mode", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{readOnly: true, history: newFake()})

		// act
		resp, body := ts.json(t, request{
			method: http.MethodPost,
			path:   "/api/history/restore/index.md",
			body:   jsonBody(t, restoreRequest{Version: version.Rev, From: version.Path}),
		})

		// assert
		assert.Equal(t, http.StatusForbidden, resp.status)
		assert.Equal(t, "read-only mode, writing is disabled", body["error"])
	})

	t.Run("is refused for a read-only token", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{withAuth: true, history: newFake()})

		// act
		resp, body := ts.json(t, request{
			method:  http.MethodPost,
			path:    "/api/history/restore/index.md",
			body:    jsonBody(t, restoreRequest{Version: version.Rev, From: version.Path}),
			headers: map[string]string{"Authorization": "Bearer " + testReadToken},
		})

		// assert
		assert.Equal(t, http.StatusForbidden, resp.status)
		assert.Equal(t, "read-only token, writing is disabled", body["error"])
	})
}

func TestHistoryAnswersOnlyForDocumentsTheStoreShows(t *testing.T) {
	// arrange
	leaked := []byte("TOKEN=abc123\n")
	secret := history.Entry{Rev: oid("a1"), Blob: oid("b2"), Path: ".env", Kind: history.KindModified}
	ts := newTestServer(t, testOpts{history: &fakeHistory{
		entries: []history.Entry{secret},
		blobs:   map[string][]byte{secret.Blob: leaked},
	}})
	require.NoError(t, os.WriteFile(filepath.Join(ts.root, ".env"), leaked, 0o600))
	before, err := os.ReadFile(filepath.Join(ts.root, "index.md"))
	require.NoError(t, err)

	restore := func(p string) request {
		return request{
			method: http.MethodPost,
			path:   "/api/history/restore/" + p,
			body:   jsonBody(t, restoreRequest{Version: secret.Rev, From: secret.Path}),
		}
	}
	tests := []struct {
		name string
		req  request
	}{
		{name: "the versions of a hidden file", req: request{path: "/api/history/.env"}},
		{name: "one version of a hidden file", req: request{path: "/api/history/.env?rev=" + secret.Rev}},
		{name: "a restore onto a hidden file", req: restore(".env")},
		{name: "a restore out of a hidden file", req: restore("index.md")},
		{name: "the versions of an attachment", req: request{path: "/api/history/images/logo.png"}},
		{name: "the versions of a .markdown file, an attachment like any other",
			req: request{path: "/api/history/long.markdown"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, body := ts.do(t, tc.req)

			// assert
			assert.Equal(t, http.StatusNotFound, resp.status)
			assert.NotContains(t, body, "abc123")
		})
	}

	// assert
	onDisk, err := os.ReadFile(filepath.Join(ts.root, "index.md"))
	require.NoError(t, err)
	assert.Equal(t, before, onDisk)
}

func TestAPIHistoryWithoutTheService(t *testing.T) {
	ts := newTestServer(t, testOpts{})

	tests := []struct {
		name   string
		method string
		path   string
	}{
		{name: "list", path: "/api/history/index.md"},
		{name: "one version", path: "/api/history/index.md?rev=" + oid("a1")},
		{name: "restore", method: http.MethodPost, path: "/api/history/restore/index.md"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, body := ts.json(t, request{
				method: tc.method,
				path:   tc.path,
				body:   jsonBody(t, restoreRequest{Version: oid("a1")}),
			})

			// assert
			assert.Equal(t, http.StatusServiceUnavailable, resp.status)
			assert.Equal(t, "history is disabled", body["error"])
		})
	}
}

func TestAPIHistoryListsWhatTheRepositoryHolds(t *testing.T) {
	at := time.Date(2024, time.March, 1, 10, 30, 0, 0, time.UTC)
	entries := []history.Entry{
		{
			Rev: oid("a1"), Short: oid("a1")[:7], Blob: oid("b2"),
			Actor: "token:agent", Message: "save index.md", Path: "index.md",
			Kind: history.KindModified, At: at,
		},
		{
			Rev: oid("c3"), Short: oid("c3")[:7], Blob: oid("d4"),
			Actor: "bob", Message: "move home.md to index.md", Path: "home.md",
			Kind: history.KindRenamed, At: at.Add(-time.Hour),
		},
		{
			Rev: oid("e5"), Short: oid("e5")[:7], Blob: "",
			Actor: "external", Message: "delete home.md", Path: "home.md",
			Kind: history.KindDeleted, At: at.Add(-2 * time.Hour),
		},
	}

	t.Run("lists every version, naming the path each one had", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{history: &fakeHistory{entries: entries}})

		// act
		resp, body := ts.json(t, request{path: "/api/history/index.md"})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.Equal(t, "index.md", body["path"])
		assert.Equal(t, false, body["degraded"])

		listed, ok := body["entries"].([]any)
		require.True(t, ok)
		require.Len(t, listed, len(entries))
		for i, raw := range listed {
			got, isMap := raw.(map[string]any)
			require.True(t, isMap)
			assert.Equal(t, entries[i].Message, got["message"])
			assert.Equal(t, string(entries[i].Kind), got["kind"])
			// a rename keeps the path the document had back then, because a
			// blob is read from the pair and today's path would not resolve
			assert.Equal(t, entries[i].Path, got["path"])
			assert.Equal(t, entries[i].Blob, got["blob"])
		}
	})

	t.Run("says the list fell behind the disk", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{history: &fakeHistory{degraded: true, entries: entries}})

		// act
		_, body := ts.json(t, request{path: "/api/history/index.md"})

		// assert
		assert.Equal(t, true, body["degraded"])
	})

	t.Run("takes a document that is not on disk, which is what a deletion leaves", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{history: &fakeHistory{entries: entries}})

		// act
		resp, body := ts.json(t, request{path: "/api/history/gone.md"})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.NotEmpty(t, body["entries"], "restoring it back is the point")
	})

	t.Run("says there is nothing yet for a document history never saw", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{history: &fakeHistory{}})

		// act
		resp, body := ts.json(t, request{path: "/api/history/index.md"})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.Empty(t, body["entries"])
	})

	t.Run("reports a repository that cannot be read", func(t *testing.T) {
		// arrange
		ts := newTestServer(t, testOpts{history: &fakeHistory{readErr: errors.New("git exploded")}})

		// act
		resp, _ := ts.json(t, request{path: "/api/history/index.md"})

		// assert
		assert.Equal(t, http.StatusInternalServerError, resp.status)
	})
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
