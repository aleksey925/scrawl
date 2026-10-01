package server

import (
	"errors"
	"fmt"
	"maps"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/history"
)

func divergedHistory() *fakeHistory {
	return &fakeHistory{
		remote:   true,
		diverged: true,
		syncErr:  "merge: the branch has diverged from origin/main",
		divergence: history.Divergence{
			Head: oid("ab"), Remote: oid("cd"),
			Lost: history.Unsynced{Paths: []string{"guide.md"}},
		},
		backup: history.ResetResult{Backup: "scrawl-backup/20261001-120000-abababa", BackupPushed: true},
	}
}

func resetBody(fake *fakeHistory, pushBackup bool) *strings.Reader {
	return strings.NewReader(fmt.Sprintf(`{"head":%q,"remote":%q,"push_backup":%t}`,
		fake.divergence.Head, fake.divergence.Remote, pushBackup))
}

// TestWhoMayReset is the one rule both routes and /api/me share. It is not the
// write guard: a read-only mirror needs the reset most, so the question is who
// is calling - and with auth off nobody is, which leaves the write guard.
func TestWhoMayReset(t *testing.T) {
	tests := []struct {
		name    string
		opts    testOpts
		local   bool
		signIn  bool
		headers map[string]string
		allowed bool
	}{
		{name: "no auth, writable project", allowed: true},
		{name: "no auth, read-only project", opts: testOpts{projectReadOnly: true}},
		{name: "no auth, read-only server", opts: testOpts{readOnly: true}},
		{name: "no auth, local project", local: true},
		{name: "a session", opts: testOpts{withAuth: true}, signIn: true, allowed: true},
		{name: "a session, read-only project", opts: testOpts{withAuth: true, projectReadOnly: true}, signIn: true, allowed: true},
		{name: "a read-write token", opts: testOpts{withAuth: true}, headers: bearer(testToken), allowed: true},
		{name: "a read-only token", opts: testOpts{withAuth: true}, headers: bearer(testReadToken)},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			fake := divergedHistory()
			fake.remote = !tc.local
			tc.opts.history = fake
			ts := newTestServer(t, tc.opts)
			headers := map[string]string{"Sec-Fetch-Site": "same-origin"}
			maps.Copy(headers, tc.headers)
			req := request{headers: headers}
			if tc.signIn {
				req.client = ts.login(t)
			}

			// act
			me, meBody := ts.json(t, withPath(req, http.MethodGet, "/api/me", nil))
			check, _ := ts.json(t, withPath(req, http.MethodPost, "/api/sync/check", nil))
			reset, _ := ts.json(t, withPath(req, http.MethodPost, "/api/sync/reset", resetBody(fake, false)))

			// assert
			require.Equal(t, http.StatusOK, me.status)
			project, ok := meBody["project"].(map[string]any)
			require.True(t, ok, meBody)
			assert.Equal(t, tc.allowed, project["can_reset"])
			assert.Equal(t, true, project["diverged"])
			want := http.StatusForbidden
			if tc.allowed {
				want = http.StatusOK
			}
			assert.Equal(t, want, check.status)
			assert.Equal(t, want, reset.status)
			assert.Len(t, fake.resets, map[bool]int{true: 1, false: 0}[tc.allowed])
		})
	}
}

func withPath(req request, method, path string, body *strings.Reader) request {
	req.method, req.path = method, path
	if body != nil {
		req.body = body
	}
	return req
}

func TestSyncCheckAnswersWhatAResetWouldLose(t *testing.T) {
	// arrange
	fake := divergedHistory()
	ts := newTestServer(t, testOpts{history: fake})

	// act
	resp, body := ts.json(t, request{method: http.MethodPost, path: "/api/sync/check"})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, map[string]any{
		"head": fake.divergence.Head, "remote": fake.divergence.Remote, "clean": false,
		"lost":            map[string]any{"paths": []any{"guide.md"}, "many": false},
		"can_push_backup": true,
	}, body)
}

func TestSyncCheckOffersNoPushOnAMirror(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{withAuth: true, projectReadOnly: true, history: divergedHistory()})

	// act
	_, body := ts.json(t, request{
		method: http.MethodPost, path: "/api/sync/check", client: ts.login(t),
		headers: map[string]string{"Sec-Fetch-Site": "same-origin"},
	})

	// assert
	assert.Equal(t, false, body["can_push_backup"])
}

func TestSyncResetHandsTheConfirmedStateToHistory(t *testing.T) {
	// arrange
	fake := divergedHistory()
	ts := newTestServer(t, testOpts{history: fake})

	// act
	resp, body := ts.json(t, request{method: http.MethodPost, path: "/api/sync/reset", body: resetBody(fake, true)})

	// assert
	assert.Equal(t, http.StatusOK, resp.status)
	assert.Equal(t, map[string]any{"backup": fake.backup.Backup, "backup_pushed": true}, body)
	assert.Equal(t, []history.ResetOp{{
		Actor: "anonymous", Head: fake.divergence.Head, Remote: fake.divergence.Remote, PushBackup: true,
	}}, fake.resets)
}

func TestSyncResetFailures(t *testing.T) {
	refused := fmt.Errorf("%w: 1 untracked paths on disk stand where the remote has files of its own: guide.md",
		history.ErrResetRefused)
	tests := []struct {
		name    string
		err     error
		status  int
		message string
	}{
		{name: "nothing to reset", err: history.ErrNotDiverged, status: http.StatusConflict,
			message: "this project has not diverged from the remote"},
		{name: "moved since the check", err: history.ErrStateChanged, status: http.StatusPreconditionFailed,
			message: "the project changed since it was checked"},
		{name: "refused, with the reason", err: refused, status: http.StatusUnprocessableEntity, message: refused.Error()},
		{name: "the remote did not answer", err: errors.New("history: sync fetch: no route"),
			status: http.StatusBadGateway, message: "history: sync fetch: no route"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			fake := divergedHistory()
			fake.resetErr = tc.err
			ts := newTestServer(t, testOpts{history: fake})

			// act
			check, checkBody := ts.json(t, request{method: http.MethodPost, path: "/api/sync/check"})
			reset, resetAnswer := ts.json(t, request{method: http.MethodPost, path: "/api/sync/reset", body: resetBody(fake, false)})

			// assert
			assert.Equal(t, tc.status, check.status)
			assert.Equal(t, map[string]any{"error": tc.message}, checkBody)
			assert.Equal(t, tc.status, reset.status)
			assert.Equal(t, map[string]any{"error": tc.message}, resetAnswer)
		})
	}
}

func TestSyncResetIsCSRFProtected(t *testing.T) {
	// arrange
	fake := divergedHistory()
	ts := newTestServer(t, testOpts{history: fake})

	// act
	resp, _ := ts.do(t, request{
		method: http.MethodPost, path: "/api/sync/reset", body: resetBody(fake, false),
		headers: map[string]string{"Sec-Fetch-Site": "cross-site"},
	})

	// assert
	assert.Equal(t, http.StatusForbidden, resp.status)
	assert.Empty(t, fake.resets)
}
