package server

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/history"
	"github.com/aleksey925/scrawl/store"
)

// fakeFormatter stands in for prettier with a change a test can read back:
// every list marker becomes a dash.
type fakeFormatter struct {
	err error
}

func fakeFormatted(text string) string { return strings.ReplaceAll(text, "* ", "- ") }

func (f *fakeFormatter) Markdown(_ context.Context, text string) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	return fakeFormatted(text), nil
}

const (
	roughNote = "# List\n\n* one\n* two\n"
	tidyNote  = "# List\n\n- one\n- two\n"
)

func TestAPIFileSaveFormatsTheNote(t *testing.T) {
	tests := []struct {
		name     string
		opts     testOpts
		path     string
		body     map[string]any
		wantDisk string
		wantBody map[string]any
	}{
		{
			name:     "a writer that is not the editor gets the stored text back",
			opts:     testOpts{formatOnSave: true},
			path:     "new.md",
			body:     map[string]any{"content": roughNote, "rev": ""},
			wantDisk: tidyNote,
			wantBody: map[string]any{"rev": store.Rev([]byte(tidyNote)), "content": tidyNote},
		},
		{
			name:     "the editor formatted the note itself, so it is stored as sent",
			opts:     testOpts{formatOnSave: true},
			path:     "new.md",
			body:     map[string]any{"content": roughNote, "rev": "", "formatted": true},
			wantDisk: roughNote,
			wantBody: map[string]any{"rev": store.Rev([]byte(roughNote))},
		},
		{
			name:     "a note that was formatted already comes back without its text",
			opts:     testOpts{formatOnSave: true},
			path:     "new.md",
			body:     map[string]any{"content": tidyNote, "rev": ""},
			wantDisk: tidyNote,
			wantBody: map[string]any{"rev": store.Rev([]byte(tidyNote))},
		},
		{
			name:     "a file that is not markdown is stored as written",
			opts:     testOpts{formatOnSave: true},
			path:     "new.txt",
			body:     map[string]any{"content": roughNote, "rev": ""},
			wantDisk: roughNote,
			wantBody: map[string]any{"rev": store.Rev([]byte(roughNote))},
		},
		{
			name:     "a space that turned it off stores the note as written",
			opts:     testOpts{},
			path:     "new.md",
			body:     map[string]any{"content": roughNote, "rev": ""},
			wantDisk: roughNote,
			wantBody: map[string]any{"rev": store.Rev([]byte(roughNote))},
		},
		{
			name:     "a note the formatter gave up on is stored as written",
			opts:     testOpts{formatOnSave: true, formatErr: errors.New("boom")},
			path:     "new.md",
			body:     map[string]any{"content": roughNote, "rev": ""},
			wantDisk: roughNote,
			wantBody: map[string]any{"rev": store.Rev([]byte(roughNote)), "format_failed": true},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			ts := newTestServer(t, tc.opts)

			// act
			resp, body := ts.json(t, request{
				method: http.MethodPut, path: "/api/file/" + tc.path, body: jsonBody(t, tc.body),
			})

			// assert
			assert.Equal(t, http.StatusOK, resp.status)
			delete(body, "mod_time")
			delete(body, "history_degraded")
			delete(body, "unpublished")
			assert.Equal(t, tc.wantBody, body)
			onDisk, err := os.ReadFile(filepath.Join(ts.root, tc.path))
			require.NoError(t, err)
			assert.Equal(t, tc.wantDisk, string(onDisk))
		})
	}
}

func TestAPIHistoryRestoreFormatsTheNote(t *testing.T) {
	// arrange
	version := history.Entry{Rev: oid("a1"), Blob: oid("b2"), Path: "index.md", Kind: history.KindModified}
	ts := newTestServer(t, testOpts{formatOnSave: true, history: &fakeHistory{
		entries: []history.Entry{version}, blobs: map[string][]byte{version.Blob: []byte(roughNote)},
	}})
	_, current := ts.json(t, request{path: "/api/file/index.md"})

	// act
	resp, body := ts.json(t, request{
		method: http.MethodPost,
		path:   "/api/history/restore/index.md",
		body:   jsonBody(t, restoreRequest{Rev: current["rev"].(string), Version: version.Rev, From: version.Path}),
	})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, store.Rev([]byte(tidyNote)), body["rev"])
	onDisk, err := os.ReadFile(filepath.Join(ts.root, "index.md"))
	require.NoError(t, err)
	assert.Equal(t, tidyNote, string(onDisk))
}
