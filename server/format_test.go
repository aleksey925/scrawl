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

	"github.com/aleksey925/scrawl/format"
	"github.com/aleksey925/scrawl/history"
	"github.com/aleksey925/scrawl/store"
)

// fakeFormatter stands in for prettier with a change a test can read back:
// every list marker becomes a dash and the cursor moves one to the right.
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

func (f *fakeFormatter) MarkdownAt(_ context.Context, text string, cursor int) (format.Result, error) {
	if f.err != nil {
		return format.Result{}, f.err
	}
	return format.Result{Text: fakeFormatted(text), Cursor: cursor + 1}, nil
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
			name:     "an editor gets the stored text and its cursor back",
			opts:     testOpts{formatOnSave: true},
			path:     "new.md",
			body:     map[string]any{"content": roughNote, "rev": "", "cursor": 4},
			wantDisk: tidyNote,
			wantBody: map[string]any{"rev": store.Rev([]byte(tidyNote)), "content": tidyNote, "cursor": float64(5)},
		},
		{
			name:     "an API client sends no cursor and gets none",
			opts:     testOpts{formatOnSave: true},
			path:     "new.md",
			body:     map[string]any{"content": roughNote, "rev": ""},
			wantDisk: tidyNote,
			wantBody: map[string]any{"rev": store.Rev([]byte(tidyNote)), "content": tidyNote},
		},
		{
			name:     "a note that was formatted already comes back without its text",
			opts:     testOpts{formatOnSave: true},
			path:     "new.md",
			body:     map[string]any{"content": tidyNote, "rev": "", "cursor": 4},
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
			body:     map[string]any{"content": roughNote, "rev": "", "cursor": 4},
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

func TestAPIFormat(t *testing.T) {
	tests := []struct {
		name       string
		opts       testOpts
		wantStatus int
		wantBody   map[string]any
	}{
		{
			name:       "formats the buffer whatever the space says about saves",
			opts:       testOpts{},
			wantStatus: http.StatusOK,
			wantBody:   map[string]any{"content": tidyNote, "cursor": float64(5)},
		},
		{
			name:       "is refused where nothing can be saved",
			opts:       testOpts{readOnly: true},
			wantStatus: http.StatusForbidden,
			wantBody:   map[string]any{"error": errMessage(store.ErrReadOnly)},
		},
		{
			name:       "a note above the cap",
			opts:       testOpts{formatErr: format.ErrTooLarge},
			wantStatus: http.StatusRequestEntityTooLarge,
			wantBody:   map[string]any{"error": "the note is too large to format"},
		},
		{
			name:       "a formatter that did not answer in time",
			opts:       testOpts{formatErr: context.DeadlineExceeded},
			wantStatus: http.StatusServiceUnavailable,
			wantBody:   map[string]any{"error": "formatting took too long"},
		},
		{
			name:       "a note prettier cannot format",
			opts:       testOpts{formatErr: errors.New("boom")},
			wantStatus: http.StatusInternalServerError,
			wantBody:   map[string]any{"error": "could not format the note"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			ts := newTestServer(t, tc.opts)

			// act
			resp, body := ts.json(t, request{
				method: http.MethodPost, path: "/api/format",
				body: jsonBody(t, formatRequest{Content: roughNote, Cursor: 4}),
			})

			// assert
			assert.Equal(t, tc.wantStatus, resp.status)
			assert.Equal(t, tc.wantBody, body)
		})
	}
}
