package auth

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestServiceClientIP(t *testing.T) {
	tests := []struct {
		name    string
		trusted bool
		remote  string
		xff     string
		real    string
		want    string
	}{
		{name: "plain remote address", remote: "203.0.113.9:4711", want: "203.0.113.9"},
		{name: "remote address without a port", remote: "203.0.113.9", want: "203.0.113.9"},
		{name: "ipv6 remote address", remote: "[2001:db8::1]:4711", want: "2001:db8::1"},
		{
			name: "headers are ignored without a trusted proxy", remote: "172.17.0.1:4711",
			xff: "1.2.3.4", real: "5.6.7.8", want: "172.17.0.1",
		},
		{
			name: "single forwarded address", trusted: true, remote: "172.17.0.1:4711",
			xff: "203.0.113.9", want: "203.0.113.9",
		},
		{
			name: "the rightmost entry wins over a forged prefix", trusted: true, remote: "172.17.0.1:4711",
			xff: "1.2.3.4, 203.0.113.9", want: "203.0.113.9",
		},
		{
			name: "junk entries are skipped", trusted: true, remote: "172.17.0.1:4711",
			xff: "203.0.113.9, not-an-ip", want: "203.0.113.9",
		},
		{
			name: "x-real-ip is the fallback", trusted: true, remote: "172.17.0.1:4711",
			real: "203.0.113.9", want: "203.0.113.9",
		},
		{
			name: "forwarded-for wins over x-real-ip", trusted: true, remote: "172.17.0.1:4711",
			xff: "203.0.113.9", real: "5.6.7.8", want: "203.0.113.9",
		},
		{
			name: "no usable header falls back to the peer", trusted: true, remote: "172.17.0.1:4711",
			xff: "garbage", real: "junk", want: "172.17.0.1",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			svc := newTestService(t, Config{TrustedProxy: tc.trusted})
			req := httptest.NewRequest(http.MethodGet, "/", http.NoBody)
			req.RemoteAddr = tc.remote
			if tc.xff != "" {
				req.Header.Set("X-Forwarded-For", tc.xff)
			}
			if tc.real != "" {
				req.Header.Set("X-Real-IP", tc.real)
			}

			// act & assert
			assert.Equal(t, tc.want, svc.clientIP(req))
		})
	}
}

func TestForgedForwardedHeaderBuysNoExtraAttempts(t *testing.T) {
	// arrange
	svc := newTestService(t, Config{TrustedProxy: true})
	now := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }

	// act
	allowed := 0
	for i := range loginBurst + 20 {
		req := httptest.NewRequest(http.MethodPost, "/login", http.NoBody)
		req.RemoteAddr = "172.17.0.1:4711"
		req.Header.Set("X-Forwarded-For", "203.0.113."+strconv.Itoa(i))
		if svc.Allow(req) {
			allowed++
		}
	}

	// assert
	assert.Equal(t, loginBurst, allowed, "a fresh forged address per attempt must not refill the peer budget")
}

func TestServiceSecureFor(t *testing.T) {
	tests := []struct {
		name    string
		mode    string
		trusted bool
		tls     bool
		proto   string
		want    bool
	}{
		{name: "auto over plain http"},
		{name: "auto over tls", tls: true, want: true},
		{name: "auto trusts x-forwarded-proto behind a proxy", trusted: true, proto: "https", want: true},
		{name: "auto takes the leftmost proto of a chain", trusted: true, proto: "https, http", want: true},
		{name: "auto with a http forwarded proto", trusted: true, proto: "http"},
		{name: "auto ignores the header without a trusted proxy", proto: "https"},
		{name: "auto with no proto header behind a proxy", trusted: true},
		{name: "always", mode: SecureAlways, want: true},
		{name: "always over plain http", mode: SecureAlways, want: true},
		{name: "never even over tls", mode: SecureNever, tls: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			svc := newTestService(t, Config{Secure: tc.mode, TrustedProxy: tc.trusted})
			req := httptest.NewRequest(http.MethodGet, "/", http.NoBody)
			if tc.tls {
				req.TLS = &tls.ConnectionState{}
			}
			if tc.proto != "" {
				req.Header.Set("X-Forwarded-Proto", tc.proto)
			}

			// act
			rec := httptest.NewRecorder()
			require.NoError(t, svc.SetCookie(rec, req, "alice"))

			// assert
			res := rec.Result()
			defer res.Body.Close()
			require.Len(t, res.Cookies(), 1)
			assert.Equal(t, tc.want, svc.secureFor(req))
			assert.Equal(t, tc.want, res.Cookies()[0].Secure)
		})
	}
}

func TestWantsJSON(t *testing.T) {
	tests := []struct {
		name   string
		target string
		accept string
		want   bool
	}{
		{name: "html page", target: "/p/a.md", accept: "text/html,application/xhtml+xml"},
		{name: "api path", target: "/api/tree", want: true},
		{name: "api path with an html accept", target: "/api/tree", accept: "text/html", want: true},
		{name: "json accept on a page", target: "/p/a.md", accept: "application/json", want: true},
		{name: "json accept among others", target: "/p/a.md", accept: "text/html, application/json;q=0.9", want: true},
		{name: "path that only looks like the api", target: "/apiary", want: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tc.target, http.NoBody)
			if tc.accept != "" {
				req.Header.Set("Accept", tc.accept)
			}
			assert.Equal(t, tc.want, wantsJSON(req))
		})
	}
}

func TestSafeRedirect(t *testing.T) {
	tests := []struct {
		name string
		from string
		want string
	}{
		{name: "empty", from: "", want: "/"},
		{name: "root", from: "/", want: "/"},
		{name: "plain path", from: "/p/notes/a.md", want: "/p/notes/a.md"},
		{name: "path with a query", from: "/search?q=go&limit=5", want: "/search?q=go&limit=5"},
		{name: "path with a fragment", from: "/p/a.md#intro", want: "/p/a.md#intro"},
		{name: "escaped path", from: "/p/%D0%9E%D0%B1%D1%89%D0%B5%D0%B5.md", want: "/p/%D0%9E%D0%B1%D1%89%D0%B5%D0%B5.md"},
		{name: "protocol relative", from: "//evil.com", want: "/"},
		{name: "protocol relative with a path", from: "//evil.com/p/a.md", want: "/"},
		{name: "absolute url", from: "https://evil.com", want: "/"},
		{name: "absolute url with a path", from: "https://evil.com/p/a.md", want: "/"},
		{name: "backslash trick", from: `/\evil.com`, want: "/"},
		{name: "double backslash", from: `\\evil.com`, want: "/"},
		{name: "crlf injection", from: "/p/a.md\r\nSet-Cookie: scrawl_session=forged", want: "/"},
		{name: "bare newline", from: "/p/a.md\nLocation: https://evil.com", want: "/"},
		{name: "null byte", from: "/p/a.md\x00", want: "/"},
		{name: "scheme relative with credentials", from: "//user:pass@evil.com/", want: "/"},
		{name: "javascript scheme", from: "javascript:alert(1)", want: "/"},
		{name: "relative path", from: "p/a.md", want: "/"},
		{name: "unparsable", from: "/%zz", want: "/"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, SafeRedirect(tc.from))
		})
	}
}

func TestSafeRedirectRoundTripsTheMiddlewareTarget(t *testing.T) {
	// arrange
	svc := newTestService(t, Config{})
	rec := httptest.NewRecorder()

	// act
	svc.Middleware(okHandler()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/search?q=go%20run", http.NoBody))

	// assert
	location, err := rec.Result().Location()
	require.NoError(t, err)
	assert.Equal(t, "/search?q=go%20run", SafeRedirect(location.Query().Get("from")))
}
