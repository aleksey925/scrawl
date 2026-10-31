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

func oid(pair string) string { return strings.Repeat(pair, 20) }

type fakeHistory struct {
	degraded bool
	failWith error
	entries  []history.Entry
	blobs    map[string][]byte
	before   map[string]history.Change
	diff     string
	readErr  error

	unpublished bool
	pushFails   error
	syncErr     string
	unsynced    history.Unsynced
	refused     bool
	syncReads   int

	remote     bool
	diverged   bool
	divergence history.Divergence
	resetErr   error
	backup     history.ResetResult
	resets     []history.ResetOp

	ops      []history.Op
	reported [][]string
}

func (f *fakeHistory) Enabled() bool     { return true }
func (f *fakeHistory) Degraded() bool    { return f.degraded }
func (f *fakeHistory) Unpublished() bool { return f.unpublished }
func (f *fakeHistory) SyncError() string { return f.syncErr }

func (f *fakeHistory) SyncState() history.SyncState {
	f.syncReads++
	return history.SyncState{Unpublished: f.unpublished, Error: f.syncErr, Unsynced: f.unsynced, Diverged: f.diverged, Refused: f.refused}
}

func (f *fakeHistory) Remote() bool { return f.remote }

func (f *fakeHistory) CheckDivergence(context.Context) (history.Divergence, error) {
	return f.divergence, f.resetErr
}

func (f *fakeHistory) ResetToRemote(_ context.Context, op history.ResetOp) (history.ResetResult, error) {
	if f.resetErr != nil {
		return history.ResetResult{}, f.resetErr
	}
	f.resets = append(f.resets, op)
	return f.backup, nil
}

func (f *fakeHistory) Record(_ context.Context, op history.Op, mutate func() ([]string, error)) error {
	paths, err := mutate()
	if err != nil {
		return err
	}
	f.ops = append(f.ops, op)
	f.reported = append(f.reported, paths)
	if f.failWith != nil {
		f.degraded = true
		if op.Strict {
			return f.failWith
		}
		return nil
	}
	if f.pushFails != nil {
		f.unpublished = true
		if op.Strict {
			return fmt.Errorf("history: %w: %w", history.ErrNotPublished, f.pushFails)
		}
	}
	return nil
}

func (f *fakeHistory) Log(context.Context, string, int) ([]history.Entry, error) {
	return f.entries, f.readErr
}

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

func (f *fakeHistory) Change(ctx context.Context, rev, p string) (history.Change, error) {
	blob, err := f.Version(ctx, rev, p)
	if err != nil {
		return history.Change{}, err
	}
	res, ok := f.before[rev]
	if !ok {
		res.From = p
	}
	res.After = blob
	return res, nil
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
			"rev":        entry.Rev,
			"short":      entry.Short,
			"blob":       entry.Blob,
			"actor":      entry.Actor,
			"message":    entry.Message,
			"path":       entry.Path,
			"kind":       string(entry.Kind),
			"at":         entry.At.Format(time.RFC3339),
			"restorable": true,
		}},
	}, body)
}

func TestAPIHistoryRestorable(t *testing.T) {
	now := []byte("# Now\n\ntext on disk\n")
	tests := []struct {
		name  string
		entry history.Entry
		write []byte
		want  bool
	}{
		{name: "a deletion holds nothing to write back",
			entry: history.Entry{Rev: oid("a1"), Path: "note.md", Kind: history.KindDeleted}, write: now},
		{name: "the version the file is now changes nothing",
			entry: history.Entry{Rev: oid("a1"), Blob: blobID(now, 40), Path: "note.md", Kind: history.KindModified}, write: now},
		{name: "a sha-256 repository is compared in its own hash",
			entry: history.Entry{Rev: oid("a1"), Blob: blobID(now, 64), Path: "note.md", Kind: history.KindModified}, write: now},
		{name: "an older version with other content",
			entry: history.Entry{Rev: oid("a1"), Blob: oid("b2"), Path: "note.md", Kind: history.KindModified},
			write: now, want: true},
		{name: "the last commit, after an edit on disk not committed yet",
			entry: history.Entry{Rev: oid("a1"), Blob: blobID(now, 40), Path: "note.md", Kind: history.KindModified},
			write: []byte("# Now\n\nedited since\n"), want: true},
		{name: "any version with content of a file no longer on disk",
			entry: history.Entry{Rev: oid("a1"), Blob: oid("b2"), Path: "note.md", Kind: history.KindModified}, want: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			ts := newTestServer(t, testOpts{history: &fakeHistory{entries: []history.Entry{tc.entry}}})
			if tc.write != nil {
				require.NoError(t, os.WriteFile(filepath.Join(ts.root, "note.md"), tc.write, 0o600))
			}

			// act
			resp, body := ts.json(t, request{path: "/api/history/note.md"})

			// assert
			require.Equal(t, http.StatusOK, resp.status)
			listed, ok := body["entries"].([]any)
			require.True(t, ok)
			require.Len(t, listed, 1)
			got, ok := listed[0].(map[string]any)
			require.True(t, ok)
			assert.Equal(t, tc.want, got["restorable"])
		})
	}
}

func TestBlobIDIsGits(t *testing.T) {
	// act & assert
	assert.Equal(t, "ce013625030ba8dba906f756967f9e9ca394464a", blobID([]byte("hello\n"), 40))
	assert.Equal(t, "2cf8d83d9ee29543b34a87727421fdecb7e3f3a183d337639025de576db9ebb4", blobID([]byte("hello\n"), 64))
}

func TestAPIHistoryVersion(t *testing.T) {
	saved := []byte("# the old one\n")
	version := history.Entry{Rev: oid("a1"), Blob: oid("b2"), Path: "index.md", Kind: history.KindModified}
	deletion := history.Entry{Rev: oid("c3"), Path: "index.md", Kind: history.KindDeleted}
	fake := &fakeHistory{
		entries: []history.Entry{version, deletion},
		blobs:   map[string][]byte{version.Blob: saved, oid("f6"): []byte("# the first one\n")},
		before: map[string]history.Change{
			deletion.Rev: {Before: version.Blob, From: "index.md"},
		},
		diff: "diff --git a/index.md b/index.md\n+the old one\n",
	}
	ts := newTestServer(t, testOpts{history: fake})

	t.Run("carries the content, the patch and the compared blocks of the version", func(t *testing.T) {
		// act
		resp, body := ts.json(t, request{path: "/api/history/index.md?rev=" + version.Rev})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.Equal(t, map[string]any{
			"path":    version.Path,
			"rev":     version.Rev,
			"content": string(saved),
			"diff":    fake.diff,
			"changes": []any{map[string]any{
				"kind": "added",
				"new":  map[string]any{"html": "<h1>the old one</h1>", "start": float64(1), "end": float64(1)},
			}},
		}, body)
	})

	t.Run("compares the version with the one before it", func(t *testing.T) {
		// arrange
		edit := history.Entry{Rev: oid("d4"), Blob: oid("b2"), Path: "index.md", Kind: history.KindModified}
		other := newTestServer(t, testOpts{history: &fakeHistory{
			entries: []history.Entry{edit},
			blobs:   fake.blobs,
			before:  map[string]history.Change{edit.Rev: {Before: oid("f6"), From: "index.md"}},
		}})

		// act
		resp, body := other.json(t, request{path: "/api/history/index.md?rev=" + edit.Rev})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.Equal(t, []any{map[string]any{
			"kind": "changed",
			"old": map[string]any{
				"html": `<h1>the <del class="diff-del">first</del> one</h1>`, "start": float64(1), "end": float64(1),
			},
			"new": map[string]any{
				"html": `<h1>the <ins class="diff-ins">old</ins> one</h1>`, "start": float64(1), "end": float64(1),
			},
			"inline": map[string]any{
				"html":  `<h1>the <del class="diff-del">first</del> <ins class="diff-ins">old</ins> one</h1>`,
				"start": float64(1), "end": float64(1),
			},
		}}, body["changes"])
	})

	t.Run("reads a version moved out of a hidden file as written from nothing", func(t *testing.T) {
		// arrange
		moved := history.Entry{Rev: oid("e5"), Blob: oid("b2"), Path: "index.md", Kind: history.KindRenamed}
		other := newTestServer(t, testOpts{history: &fakeHistory{
			entries: []history.Entry{moved},
			blobs:   fake.blobs,
			before:  map[string]history.Change{moved.Rev: {Before: oid("f6"), From: ".draft.md"}},
		}})

		// act
		resp, body := other.json(t, request{path: "/api/history/index.md?rev=" + moved.Rev})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.Equal(t, []any{map[string]any{
			"kind": "added",
			"new":  map[string]any{"html": "<h1>the old one</h1>", "start": float64(1), "end": float64(1)},
		}}, body["changes"])
	})

	t.Run("leaves out the content of a deletion, which recorded none", func(t *testing.T) {
		// act
		resp, body := ts.json(t, request{path: "/api/history/index.md?rev=" + deletion.Rev})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.NotContains(t, body, "content")
		assert.Equal(t, []any{map[string]any{
			"kind": "removed",
			"old":  map[string]any{"html": "<h1>the old one</h1>", "start": float64(1), "end": float64(1)},
		}}, body["changes"])
	})

	t.Run("keeps the patch of a version too large to compare", func(t *testing.T) {
		// arrange
		huge := history.Entry{Rev: oid("a7"), Blob: oid("b8"), Path: "index.md", Kind: history.KindModified}
		other := newTestServer(t, testOpts{history: &fakeHistory{
			entries: []history.Entry{huge},
			blobs:   map[string][]byte{huge.Blob: bytes.Repeat([]byte("a"), maxRenderBytes+1)},
			diff:    fake.diff,
		}})

		// act
		resp, body := other.json(t, request{path: "/api/history/index.md?rev=" + huge.Rev})

		// assert
		assert.Equal(t, http.StatusOK, resp.status)
		assert.Equal(t, fake.diff, body["diff"])
		assert.NotContains(t, body, "changes")
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

func TestAWriteTheRemoteMissed(t *testing.T) {
	// arrange
	fake := &fakeHistory{pushFails: errors.New("the remote refused")}
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
	assert.Equal(t, "the change was written and recorded, but not pushed to the remote", agentBody["error"])
	assert.FileExists(t, filepath.Join(ts.root, "agent.md"), "the write itself still happened")

	assert.Equal(t, http.StatusOK, browser.status, "a browser save stands and the banner says so")
	assert.Equal(t, true, browserBody["unpublished"])
	assert.Equal(t, false, browserBody["history_degraded"],
		"the commit landed, so the commit state is healthy")
}

func TestEveryMutationCarriesTheState(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{history: &fakeHistory{unpublished: true, degraded: true}})

	tests := []struct {
		name    string
		request request
		status  int
	}{
		{
			name: "save", status: http.StatusOK,
			request: request{
				method: http.MethodPut, path: "/api/file/guide.md",
				body: jsonBody(t, saveRequest{Content: "# guide\n", Rev: revOf(t, ts, "guide.md")}),
			},
		},
		{
			name: "create", status: http.StatusCreated,
			request: request{
				method: http.MethodPost, path: "/api/file/fresh.md",
				body: jsonBody(t, createRequest{Type: "file"}),
			},
		},
		{
			name: "rename", status: http.StatusOK,
			request: request{
				method: http.MethodPost, path: "/api/move",
				body: jsonBody(t, moveRequest{From: "docs/page.md", To: "docs/moved.md"}),
			},
		},
		{
			name:    "delete",
			request: request{method: http.MethodDelete, path: "/api/file/docs/moved.md"},
			status:  http.StatusOK,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			resp, body := ts.json(t, tc.request)

			// assert
			require.Equal(t, tc.status, resp.status, body)
			assert.Equal(t, true, body["unpublished"])
			assert.Equal(t, true, body["history_degraded"])
		})
	}
}

func TestAPIMeReportsThePublicationState(t *testing.T) {
	// arrange
	fake := &fakeHistory{
		unpublished: true,
		syncErr:     "push: the remote refused",
		unsynced:    history.Unsynced{Paths: []string{"guide.md", "images/logo.png"}},
		refused:     true,
	}
	ts := newTestServer(t, testOpts{history: fake})

	// act
	resp, body := ts.json(t, request{path: "/api/me"})

	// assert
	space, ok := body["space"].(map[string]any)
	require.True(t, ok, body)
	assert.Equal(t, true, space["unpublished"])
	assert.Equal(t, "push: the remote refused", space["sync_error"])
	assert.Equal(t, true, space["push_refused"])
	assert.Equal(t, map[string]any{
		"paths": []any{"guide.md", "images/logo.png"}, "many": false,
	}, space["unsynced"])
	assert.Equal(t, "private, no-store", resp.header.Get("Cache-Control"))
	assert.Equal(t, 1, fake.syncReads,
		"one load, or an error could be paired with another attempt's paths")
}

func TestAPIMeReportsTheDegradedPathSet(t *testing.T) {
	tests := []struct {
		name     string
		history  History
		expected map[string]any
	}{
		{
			name:     "no history at all",
			expected: map[string]any{"paths": []any{}, "many": false},
		},
		{
			name:     "too many to list",
			history:  &fakeHistory{unpublished: true, unsynced: history.Unsynced{Many: true}},
			expected: map[string]any{"paths": []any{}, "many": true},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			ts := newTestServer(t, testOpts{history: tc.history})

			// act
			_, body := ts.json(t, request{path: "/api/me"})

			// assert
			space, ok := body["space"].(map[string]any)
			require.True(t, ok, body)
			assert.Equal(t, tc.expected, space["unsynced"])
		})
	}
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
