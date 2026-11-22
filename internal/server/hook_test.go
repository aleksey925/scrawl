package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

const hookSecret = "0123456789abcdef0123456789abcdef"

const hookBody = `{"ref":"refs/heads/main"}`

func signBody(secret, body string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(body))
	return signaturePrefix + hex.EncodeToString(mac.Sum(nil))
}

func TestHookAcceptsAVerifiedDelivery(t *testing.T) {
	tests := []struct {
		name    string
		headers map[string]string
	}{
		{
			name:    "a github signature",
			headers: map[string]string{hubSignatureHeader: signBody(hookSecret, hookBody)},
		},
		{
			name:    "a gitlab token",
			headers: map[string]string{gitlabTokenHeader: hookSecret},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			ts := newTestServer(t, testOpts{hook: true})

			// act
			resp, body := ts.do(t, request{
				method: http.MethodPost, path: "/hook",
				body: strings.NewReader(hookBody), headers: tc.headers,
			})

			// assert
			assert.Equal(t, http.StatusAccepted, resp.status)
			assert.Empty(t, body)
			assert.Equal(t, 1, ts.notified)
		})
	}
}

func TestHookRefusesEverythingElse(t *testing.T) {
	tests := []struct {
		name    string
		headers map[string]string
		body    string
		status  int
	}{
		{
			name:   "no header at all",
			body:   hookBody,
			status: http.StatusUnauthorized,
		},
		{
			name:    "a signature of another body",
			headers: map[string]string{hubSignatureHeader: signBody(hookSecret, "{}")},
			body:    hookBody,
			status:  http.StatusUnauthorized,
		},
		{
			name:    "a signature under another secret",
			headers: map[string]string{hubSignatureHeader: signBody("something else entirely 0123456789", hookBody)},
			body:    hookBody,
			status:  http.StatusUnauthorized,
		},
		{
			name:    "no sha256 prefix",
			headers: map[string]string{hubSignatureHeader: strings.TrimPrefix(signBody(hookSecret, hookBody), signaturePrefix)},
			body:    hookBody,
			status:  http.StatusUnauthorized,
		},
		{
			name:    "bad hex",
			headers: map[string]string{hubSignatureHeader: signaturePrefix + strings.Repeat("z", 64)},
			body:    hookBody,
			status:  http.StatusUnauthorized,
		},
		{
			name:    "the wrong length",
			headers: map[string]string{hubSignatureHeader: signaturePrefix + "abcd"},
			body:    hookBody,
			status:  http.StatusUnauthorized,
		},
		{
			name:    "a wrong gitlab token",
			headers: map[string]string{gitlabTokenHeader: "not the secret"},
			body:    hookBody,
			status:  http.StatusUnauthorized,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			ts := newTestServer(t, testOpts{hook: true})

			// act
			resp, _ := ts.do(t, request{
				method: http.MethodPost, path: "/hook",
				body: strings.NewReader(tc.body), headers: tc.headers,
			})

			// assert
			assert.Equal(t, tc.status, resp.status)
			assert.Zero(t, ts.notified, "nothing below the verification may run")
		})
	}
}

func TestHookRefusesAnOversizedBody(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{hook: true})
	oversized := strings.Repeat("x", maxHookBody+1)

	// act
	resp, _ := ts.do(t, request{
		method: http.MethodPost, path: "/hook",
		body:    strings.NewReader(oversized),
		headers: map[string]string{hubSignatureHeader: signBody(hookSecret, oversized)},
	})

	// assert
	assert.Equal(t, http.StatusRequestEntityTooLarge, resp.status)
	assert.Zero(t, ts.notified)
}

func TestHookAnswersOneStatusForEveryOtherMethod(t *testing.T) {
	tests := []struct {
		name   string
		method string
	}{
		{name: "get", method: http.MethodGet},
		{name: "head", method: http.MethodHead},
		{name: "put", method: http.MethodPut},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			ts := newTestServer(t, testOpts{hook: true})

			// act
			resp, body := ts.do(t, request{method: tc.method, path: "/hook"})

			// assert
			assert.Equal(t, http.StatusMethodNotAllowed, resp.status)
			assert.NotContains(t, body, "scrawl-app-root", "never the app shell on a public path")
			assert.Zero(t, ts.notified)
		})
	}
}

func TestASpaceWithoutAWebhookHasNoSuchRoute(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{})

	// act
	posted, postedBody := ts.do(t, request{
		method: http.MethodPost, path: "/hook", body: strings.NewReader(hookBody),
		headers: map[string]string{hubSignatureHeader: signBody(hookSecret, hookBody)},
	})
	got, _ := ts.do(t, request{path: "/hook"})

	// assert
	assert.Equal(t, http.StatusMethodNotAllowed, posted.status)
	assert.NotContains(t, postedBody, "scrawl-app-root")
	assert.Equal(t, http.StatusNotFound, got.status)
}

func TestTheHookRouteDoesNotCollideWithTheShellCatchAll(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{second: secondSpace})
	ts.Spaces[0].Webhook = &Webhook{Secret: hookSecret, Notify: func() {}}
	ts.second().Webhook = &Webhook{Secret: hookSecret, Notify: func() {}}

	// act & assert
	assert.NotPanics(t, func() {
		_, err := ts.router()
		assert.NoError(t, err)
	})
}

func TestTheHookIsReachableWithoutASession(t *testing.T) {
	// arrange
	ts := newTestServer(t, testOpts{hook: true, withAuth: true})

	// act
	hook, _ := ts.do(t, request{
		method: http.MethodPost, path: "/hook",
		body:    strings.NewReader(hookBody),
		headers: map[string]string{hubSignatureHeader: signBody(hookSecret, hookBody)},
	})
	page, _ := ts.do(t, request{path: "/doc/guide.md"})
	below, _ := ts.do(t, request{method: http.MethodPost, path: "/hook/anything"})

	// assert
	assert.Equal(t, http.StatusAccepted, hook.status)
	assert.Equal(t, 1, ts.notified)
	assert.Equal(t, http.StatusFound, page.status, "everything else still needs a session")
	assert.NotEqual(t, http.StatusAccepted, below.status, "nothing below the path is public")
}
