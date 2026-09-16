package auth

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

const (
	testPassword = "s3cr3t"
	testSecret   = "0123456789abcdef0123456789abcdef"
)

// testHash is a bcrypt hash of testPassword at the cheapest cost, so the suite
// does not spend a hundred milliseconds per comparison.
var testHash = mustHash(testPassword, bcrypt.MinCost)

func mustHash(password string, cost int) string {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), cost)
	if err != nil {
		panic(err)
	}
	return string(hash)
}

func newTestService(t *testing.T, cfg Config) *Service {
	t.Helper()
	if cfg.Users == "" && !cfg.Disabled {
		cfg.Users = "alice:" + testHash
	}
	if cfg.Secret == "" && cfg.SecretFile == "" {
		cfg.Secret = testSecret
	}
	svc, err := NewService(cfg)
	require.NoError(t, err)
	return svc
}

// withSession issues a session cookie for user and attaches it to r.
func withSession(t *testing.T, svc *Service, r *http.Request, user string) *http.Request {
	t.Helper()
	rec := httptest.NewRecorder()
	require.NoError(t, svc.SetCookie(rec, r, user))
	res := rec.Result()
	defer res.Body.Close()
	require.NotEmpty(t, res.Cookies())
	for _, cookie := range res.Cookies() {
		r.AddCookie(cookie)
	}
	return r
}

func TestNewService(t *testing.T) {
	tests := []struct {
		name string
		cfg  Config
		err  string
	}{
		{name: "one hashed user", cfg: Config{Users: "alice:" + testHash, Secret: testSecret}},
		{name: "one plain user", cfg: Config{Users: "alice:pass", Secret: testSecret}},
		{name: "disabled without users", cfg: Config{Disabled: true}},
		{name: "tokens without users", cfg: Config{Tokens: "bot:" + TokenDigest(testAPIToken), Secret: testSecret}},
		{name: "no users and no tokens", cfg: Config{Secret: testSecret}, err: "no users and no tokens configured"},
		{name: "broken users", cfg: Config{Users: "alice", Secret: testSecret}, err: "bad user entry"},
		{name: "broken tokens", cfg: Config{Users: "alice:pass", Tokens: "bot", Secret: testSecret}, err: "bad token entry"},
		{
			name: "unknown secure mode",
			cfg:  Config{Users: "alice:pass", Secret: testSecret, Secure: "sometimes"},
			err:  `unknown secure mode "sometimes"`,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc, err := NewService(tc.cfg)
			if tc.err != "" {
				assert.Nil(t, svc)
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.err)
				return
			}
			require.NoError(t, err)
			assert.NotNil(t, svc)
		})
	}
}

func TestNewServiceWarnsAboutANameSharedByAUserAndAToken(t *testing.T) {
	// arrange
	var logged bytes.Buffer
	original := log.Writer()
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(original) })

	// act
	svc, err := NewService(Config{
		Users:  "alice:" + testHash + ",bob:" + testHash,
		Tokens: "alice:" + TokenDigest(testAPIToken) + ",reader:" + TokenDigest(testReadToken),
		Secret: testSecret,
	})

	// assert
	require.NoError(t, err)
	assert.NotNil(t, svc)
	assert.Contains(t, logged.String(), `[WARN] "alice" names both a user and a token`)
	assert.NotContains(t, logged.String(), `"reader" names both`)
	assert.NotContains(t, logged.String(), `"bob" names both`)
}

func TestNewServiceDefaults(t *testing.T) {
	// act
	svc := newTestService(t, Config{})

	// assert
	assert.Equal(t, DefaultTTL, svc.ttl)
	assert.Equal(t, SecureAuto, svc.secure)
	assert.Equal(t, defaultPublicPrefixes, svc.public)
	assert.Len(t, svc.secret, 32)
}

func TestServiceDisabled(t *testing.T) {
	// arrange
	svc := newTestService(t, Config{Disabled: true})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/tree", http.NoBody)

	// act
	svc.Middleware(okHandler()).ServeHTTP(rec, req)

	// assert
	user, ok := svc.User(req)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Empty(t, user)
	assert.True(t, ok)
	assert.True(t, svc.Allow(req))
	assert.False(t, svc.Check("alice", testPassword))
	assert.NoError(t, svc.SetCookie(rec, req, "alice"))
	assert.Empty(t, rec.Result().Cookies())
	svc.Failed(req)
}

func TestServiceMiddleware(t *testing.T) {
	svc := newTestService(t, Config{})

	tests := []struct {
		name     string
		target   string
		accept   string
		session  bool
		code     int
		location string
		body     string
	}{
		{name: "valid session", target: "/p/a.md", session: true, code: http.StatusOK, body: "alice"},
		{
			name: "html without session", target: "/p/a.md?x=1", code: http.StatusFound,
			location: "/login?from=" + url.QueryEscape("/p/a.md?x=1"),
		},
		{name: "api without session", target: "/api/tree", code: http.StatusUnauthorized, body: `{"error":"unauthorized"}`},
		{
			name: "json accept without session", target: "/p/a.md", accept: "application/json",
			code: http.StatusUnauthorized, body: `{"error":"unauthorized"}`,
		},
		{name: "public login", target: "/login", code: http.StatusOK},
		{name: "public login subpath", target: "/login/reset", code: http.StatusOK},
		{name: "public static", target: "/static/v1/css/style.css", code: http.StatusOK},
		{name: "public ping", target: "/ping", code: http.StatusOK},
		{
			name: "prefix is not a substring match", target: "/loginpage", code: http.StatusFound,
			location: "/login?from=" + url.QueryEscape("/loginpage"),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			req := httptest.NewRequest(http.MethodGet, tc.target, http.NoBody)
			if tc.accept != "" {
				req.Header.Set("Accept", tc.accept)
			}
			if tc.session {
				req = withSession(t, svc, req, "alice")
			}
			rec := httptest.NewRecorder()

			// act
			svc.Middleware(okHandler()).ServeHTTP(rec, req)

			// assert
			assert.Equal(t, tc.code, rec.Code)
			assert.Equal(t, tc.location, rec.Header().Get("Location"))
			if tc.body != "" {
				assert.Contains(t, rec.Body.String(), tc.body)
			}
		})
	}
}

func TestServiceMiddlewareBearerToken(t *testing.T) {
	svc := newTestService(t, Config{
		Tokens: "bot:" + TokenDigest(testAPIToken) + ",reader:" + TokenDigest(testReadToken) + ":ro",
	})

	tests := []struct {
		name     string
		target   string
		header   string
		session  bool
		code     int
		user     string
		byToken  bool
		readOnly bool
		body     string
	}{
		{
			name: "read-write token", target: "/api/tree", header: "Bearer " + testAPIToken,
			code: http.StatusOK, user: "bot", byToken: true,
		},
		{
			name: "read-only token", target: "/api/tree", header: "Bearer " + testReadToken,
			code: http.StatusOK, user: "reader", byToken: true, readOnly: true,
		},
		{
			name: "scheme is case-insensitive", target: "/api/tree", header: "bearer " + testAPIToken,
			code: http.StatusOK, user: "bot", byToken: true,
		},
		{
			name: "a token also authenticates an html path", target: "/p/a.md", header: "Bearer " + testAPIToken,
			code: http.StatusOK, user: "bot", byToken: true,
		},
		{
			name: "wrong token on an html path", target: "/p/a.md", header: "Bearer nope",
			code: http.StatusUnauthorized, body: `{"error":"unauthorized"}`,
		},
		{
			name: "wrong token on a public path", target: "/login", header: "Bearer nope",
			code: http.StatusUnauthorized, body: `{"error":"unauthorized"}`,
		},
		{
			name: "a tab separated token", target: "/api/tree", header: "Bearer\t" + testAPIToken,
			code: http.StatusOK, user: "bot", byToken: true,
		},
		{
			name: "empty credential", target: "/api/tree", header: "Bearer ",
			code: http.StatusUnauthorized, body: `{"error":"unauthorized"}`,
		},
		{
			name: "the scheme alone beats a valid cookie", target: "/p/a.md", header: "Bearer", session: true,
			code: http.StatusUnauthorized, body: `{"error":"unauthorized"}`,
		},
		{
			name: "the scheme alone on a public path", target: "/login", header: "Bearer",
			code: http.StatusUnauthorized, body: `{"error":"unauthorized"}`,
		},
		{
			name: "a token beats the cookie", target: "/p/a.md", header: "Bearer " + testReadToken, session: true,
			code: http.StatusOK, user: "reader", byToken: true, readOnly: true,
		},
		{
			name: "a wrong token beats a valid cookie", target: "/p/a.md", header: "Bearer nope", session: true,
			code: http.StatusUnauthorized, body: `{"error":"unauthorized"}`,
		},
		{
			name: "another scheme falls through to the cookie", target: "/p/a.md", header: "Basic YWxpY2U6cGFzcw==",
			session: true, code: http.StatusOK, user: "alice",
		},
		{
			name: "another scheme without a cookie is redirected", target: "/p/a.md", header: "Basic YWxpY2U6cGFzcw==",
			code: http.StatusFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			req := httptest.NewRequest(http.MethodGet, tc.target, http.NoBody)
			req.Header.Set("Authorization", tc.header)
			if tc.session {
				req = withSession(t, svc, req, "alice")
			}
			rec := httptest.NewRecorder()
			var user string
			var byToken, readOnly bool

			// act
			svc.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				user, _ = svc.User(r)
				byToken, readOnly = ByToken(r), ReadOnlyToken(r)
				w.WriteHeader(http.StatusOK)
			})).ServeHTTP(rec, req)

			// assert
			assert.Equal(t, tc.code, rec.Code)
			assert.Equal(t, tc.user, user)
			assert.Equal(t, tc.byToken, byToken)
			assert.Equal(t, tc.readOnly, readOnly)
			if tc.body != "" {
				assert.Contains(t, rec.Body.String(), tc.body)
				assert.Equal(t, "application/json; charset=utf-8", rec.Header().Get("Content-Type"))
			}
		})
	}
}

func TestServiceMiddlewareNeverCookiesTheTokenPath(t *testing.T) {
	// arrange
	svc := newTestService(t, Config{TTL: 96 * time.Hour, Tokens: "bot:" + TokenDigest(testAPIToken)})
	issued := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return issued }
	req := withSession(t, svc, httptest.NewRequest(http.MethodGet, "/p/a.md", http.NoBody), "alice")
	req.Header.Set("Authorization", "Bearer "+testAPIToken)
	// past half the ttl, which is when the cookie path renews the session
	svc.now = func() time.Time { return issued.Add(72 * time.Hour) }
	rec := httptest.NewRecorder()

	// act
	svc.Middleware(okHandler()).ServeHTTP(rec, req)

	// assert
	res := rec.Result()
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Empty(t, res.Cookies())
}

func TestServiceMiddlewarePublicPrefixes(t *testing.T) {
	t.Run("custom list replaces the default", func(t *testing.T) {
		// arrange
		svc := newTestService(t, Config{PublicPrefixes: []string{"/health"}})

		// act
		open := httptest.NewRecorder()
		svc.Middleware(okHandler()).ServeHTTP(open, httptest.NewRequest(http.MethodGet, "/health/live", http.NoBody))
		closed := httptest.NewRecorder()
		svc.Middleware(okHandler()).ServeHTTP(closed, httptest.NewRequest(http.MethodGet, "/login", http.NoBody))

		// assert
		assert.Equal(t, http.StatusOK, open.Code)
		assert.Equal(t, http.StatusFound, closed.Code)
	})

	t.Run("empty list makes everything private", func(t *testing.T) {
		// arrange
		svc := newTestService(t, Config{PublicPrefixes: []string{}})
		rec := httptest.NewRecorder()

		// act
		svc.Middleware(okHandler()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/login", http.NoBody))

		// assert
		assert.Equal(t, http.StatusFound, rec.Code)
	})
}

func TestServiceMiddlewareSlidingRenewal(t *testing.T) {
	tests := []struct {
		name       string
		elapsed    time.Duration
		background bool
		renewed    bool
	}{
		{name: "fresh session is left alone", elapsed: time.Hour},
		{name: "just below half the ttl", elapsed: 47*time.Hour + 59*time.Minute},
		{name: "past half the ttl", elapsed: 49 * time.Hour, renewed: true},
		{name: "close to the end", elapsed: 95 * time.Hour, renewed: true},
		// a tab polling once a minute would otherwise keep an unattended
		// session alive forever
		{name: "a background request never renews", elapsed: 49 * time.Hour, background: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			svc := newTestService(t, Config{TTL: 96 * time.Hour})
			issued := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
			svc.now = func() time.Time { return issued }
			req := withSession(t, svc, httptest.NewRequest(http.MethodGet, "/p/notes/api/me", http.NoBody), "alice")
			if tc.background {
				req.Header.Set(backgroundHeader, "1")
			}
			svc.now = func() time.Time { return issued.Add(tc.elapsed) }
			rec := httptest.NewRecorder()

			// act
			svc.Middleware(okHandler()).ServeHTTP(rec, req)

			// assert
			res := rec.Result()
			defer res.Body.Close()
			assert.Equal(t, http.StatusOK, rec.Code)
			assert.Equal(t, tc.renewed, len(res.Cookies()) == 1)
		})
	}
}

func TestServiceUser(t *testing.T) {
	svc := newTestService(t, Config{})

	t.Run("from the middleware context", func(t *testing.T) {
		// arrange
		req := withSession(t, svc, httptest.NewRequest(http.MethodGet, "/p/a.md", http.NoBody), "alice")
		var got string
		var ok bool

		// act
		svc.Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			got, ok = svc.User(r)
		})).ServeHTTP(httptest.NewRecorder(), req)

		// assert
		assert.Equal(t, "alice", got)
		assert.True(t, ok)
	})

	t.Run("from the cookie outside the middleware", func(t *testing.T) {
		// arrange
		req := withSession(t, svc, httptest.NewRequest(http.MethodGet, "/login", http.NoBody), "alice")

		// act
		got, ok := svc.User(req)

		// assert
		assert.Equal(t, "alice", got)
		assert.True(t, ok)
	})

	t.Run("without a session", func(t *testing.T) {
		got, ok := svc.User(httptest.NewRequest(http.MethodGet, "/login", http.NoBody))
		assert.Empty(t, got)
		assert.False(t, ok)
	})
}

func TestServiceActor(t *testing.T) {
	svc := newTestService(t, Config{Tokens: "bot:" + TokenDigest(testAPIToken)})

	t.Run("api token", func(t *testing.T) {
		// arrange
		req := httptest.NewRequest(http.MethodGet, "/api/tree", http.NoBody)
		req.Header.Set("Authorization", "Bearer "+testAPIToken)
		var got string

		// act
		svc.Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			got = svc.Actor(r)
		})).ServeHTTP(httptest.NewRecorder(), req)

		// assert
		assert.Equal(t, tokenActorPrefix+"bot", got)
	})

	t.Run("session", func(t *testing.T) {
		// arrange
		req := withSession(t, svc, httptest.NewRequest(http.MethodGet, "/p/a.md", http.NoBody), "alice")

		// act
		got := svc.Actor(req)

		// assert
		assert.Equal(t, "alice", got)
	})

	t.Run("auth disabled", func(t *testing.T) {
		// arrange
		disabled := newTestService(t, Config{Disabled: true})

		// act
		got := disabled.Actor(httptest.NewRequest(http.MethodGet, "/p/a.md", http.NoBody))

		// assert
		assert.Equal(t, anonymousActor, got)
	})

	t.Run("without a session", func(t *testing.T) {
		// act
		got := svc.Actor(httptest.NewRequest(http.MethodGet, "/login", http.NoBody))

		// assert
		assert.Equal(t, anonymousActor, got)
	})
}

func TestCSRF(t *testing.T) {
	tests := []struct {
		name     string
		target   string
		method   string
		site     string
		code     int
		wantJSON bool
	}{
		{name: "same origin write", target: "/api/file/a.md", method: http.MethodPut, site: "same-origin", code: http.StatusOK},
		{name: "safe method is always allowed", target: "/api/tree", method: http.MethodGet, site: "cross-site", code: http.StatusOK},
		{
			name: "cross site api write", target: "/api/file/a.md", method: http.MethodPut, site: "cross-site",
			code: http.StatusForbidden, wantJSON: true,
		},
		{
			name: "cross site form post", target: "/login", method: http.MethodPost, site: "cross-site",
			code: http.StatusForbidden,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			req := httptest.NewRequest(tc.method, tc.target, http.NoBody)
			req.Header.Set("Sec-Fetch-Site", tc.site)
			rec := httptest.NewRecorder()

			// act
			CSRF()(okHandler()).ServeHTTP(rec, req)

			// assert
			assert.Equal(t, tc.code, rec.Code)
			if tc.wantJSON {
				assert.Contains(t, rec.Body.String(), `{"error":"cross-origin request blocked"}`)
				assert.Equal(t, "application/json; charset=utf-8", rec.Header().Get("Content-Type"))
			}
		})
	}
}

func TestCSRFSkipsTokenAuthenticatedRequests(t *testing.T) {
	// arrange
	svc := newTestService(t, Config{Tokens: "bot:" + TokenDigest(testAPIToken)})
	req := httptest.NewRequest(http.MethodPut, "/api/file/a.md", http.NoBody)
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	req.Header.Set("Authorization", "Bearer "+testAPIToken)
	rec := httptest.NewRecorder()

	// act
	svc.Middleware(CSRF()(okHandler())).ServeHTTP(rec, req)

	// assert
	assert.Equal(t, http.StatusOK, rec.Code)
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, _ := r.Context().Value(userKey{}).(string)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(user))
	})
}
