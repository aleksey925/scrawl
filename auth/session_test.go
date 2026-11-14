package auth

import (
	"crypto/sha256"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

func issue(t *testing.T, svc *Service, user string) string {
	t.Helper()
	rec := httptest.NewRecorder()
	require.NoError(t, svc.SetCookie(rec, httptest.NewRequest(http.MethodGet, "/", http.NoBody), user))
	res := rec.Result()
	defer res.Body.Close()
	require.Len(t, res.Cookies(), 1)
	return res.Cookies()[0].Value
}

func TestServiceSetCookie(t *testing.T) {
	t.Run("round trip", func(t *testing.T) {
		// arrange
		svc := newTestService(t, Config{TTL: time.Hour})

		// act
		tok, ok := svc.parse(issue(t, svc, "alice"), svc.now())

		// assert
		require.True(t, ok)
		assert.Equal(t, "alice", tok.user)
		assert.WithinDuration(t, time.Now().Add(time.Hour), tok.expiry, time.Minute)
	})

	t.Run("cookie attributes", func(t *testing.T) {
		// arrange
		svc := newTestService(t, Config{TTL: 2 * time.Hour})
		rec := httptest.NewRecorder()

		// act
		require.NoError(t, svc.SetCookie(rec, httptest.NewRequest(http.MethodGet, "/", http.NoBody), "alice"))

		// assert
		res := rec.Result()
		defer res.Body.Close()
		require.Len(t, res.Cookies(), 1)
		cookie := res.Cookies()[0]
		assert.Equal(t, CookieName, cookie.Name)
		assert.Equal(t, "/", cookie.Path)
		assert.True(t, cookie.HttpOnly)
		assert.Equal(t, http.SameSiteLaxMode, cookie.SameSite)
		assert.Equal(t, 7200, cookie.MaxAge)
	})

	t.Run("two logins produce different cookies", func(t *testing.T) {
		svc := newTestService(t, Config{})
		assert.NotEqual(t, issue(t, svc, "alice"), issue(t, svc, "alice"))
	})

	t.Run("unknown user", func(t *testing.T) {
		// arrange
		svc := newTestService(t, Config{})
		rec := httptest.NewRecorder()

		// act
		err := svc.SetCookie(rec, httptest.NewRequest(http.MethodGet, "/", http.NoBody), "mallory")

		// assert
		require.Error(t, err)
		assert.Contains(t, err.Error(), `unknown user "mallory"`)
		assert.Empty(t, rec.Result().Cookies())
	})
}

func TestServiceClearCookie(t *testing.T) {
	// arrange
	svc := newTestService(t, Config{})
	rec := httptest.NewRecorder()

	// act
	svc.ClearCookie(rec, httptest.NewRequest(http.MethodGet, "/", http.NoBody))

	// assert
	res := rec.Result()
	defer res.Body.Close()
	require.Len(t, res.Cookies(), 1)
	cookie := res.Cookies()[0]
	assert.Empty(t, cookie.Value)
	assert.Equal(t, -1, cookie.MaxAge)
	assert.Equal(t, time.Unix(0, 0).UTC(), cookie.Expires.UTC())
	assert.True(t, cookie.HttpOnly)
}

func TestServiceParseRejects(t *testing.T) {
	svc := newTestService(t, Config{Users: "alice:" + testHash + ",bob:pass", TTL: time.Hour})
	valid := issue(t, svc, "alice")
	parts := strings.Split(valid, tokenSep)
	require.Len(t, parts, 4)

	flipped := []byte(parts[3])
	flipped[0] ^= 'a' ^ 'b'
	future := strconv.FormatInt(time.Now().Add(100*time.Hour).Unix(), 10)

	tests := []struct {
		name  string
		value string
	}{
		{name: "empty", value: ""},
		{name: "not a token", value: "garbage"},
		{name: "too few fields", value: parts[0] + tokenSep + parts[1] + tokenSep + parts[3]},
		{name: "flipped signature byte", value: strings.Join([]string{parts[0], parts[1], parts[2], string(flipped)}, tokenSep)},
		{name: "signature is not base64", value: strings.Join([]string{parts[0], parts[1], parts[2], "!!!"}, tokenSep)},
		{name: "user is not base64", value: strings.Join([]string{"!!!", parts[1], parts[2], parts[3]}, tokenSep)},
		{
			name:  "changed user",
			value: strings.Join([]string{b64.EncodeToString([]byte("bob")), parts[1], parts[2], parts[3]}, tokenSep),
		},
		{name: "changed expiry", value: strings.Join([]string{parts[0], future, parts[2], parts[3]}, tokenSep)},
		{name: "expiry is not a number", value: strings.Join([]string{parts[0], "later", parts[2], parts[3]}, tokenSep)},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, ok := svc.parse(tc.value, time.Now())
			assert.False(t, ok)
		})
	}
}

func TestServiceParseExpiry(t *testing.T) {
	// arrange
	svc := newTestService(t, Config{TTL: time.Hour})
	issued := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return issued }
	value := issue(t, svc, "alice")

	// act & assert
	_, live := svc.parse(value, issued.Add(59*time.Minute))
	_, atExpiry := svc.parse(value, issued.Add(time.Hour))
	_, expired := svc.parse(value, issued.Add(2*time.Hour))
	assert.True(t, live)
	assert.False(t, atExpiry)
	assert.False(t, expired)
}

func TestServiceSessionInvalidation(t *testing.T) {
	tests := []struct {
		name          string
		before, after string
		secret        string
		otherSurvives bool
	}{
		{
			name:   "user removed",
			before: "alice:" + testHash + ",bob:pass", after: "bob:pass",
			otherSurvives: true,
		},
		{
			name:   "hashed password rotated",
			before: "alice:" + testHash + ",bob:pass", after: "alice:" + mustHash("new", 4) + ",bob:pass",
			otherSurvives: true,
		},
		{
			name:   "plain password rotated",
			before: "alice:one,bob:pass", after: "alice:two,bob:pass",
			otherSurvives: true,
		},
		{
			name:   "secret changed",
			before: "alice:" + testHash + ",bob:pass", after: "alice:" + testHash + ",bob:pass",
			secret: "fedcba9876543210fedcba9876543210",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			before := newTestService(t, Config{Users: tc.before})
			rotated, untouched := issue(t, before, "alice"), issue(t, before, "bob")
			after := newTestService(t, Config{Users: tc.after, Secret: tc.secret})

			// act
			_, ok := after.parse(rotated, time.Now())
			_, others := after.parse(untouched, time.Now())

			// assert
			assert.False(t, ok)
			assert.Equal(t, tc.otherSurvives, others, "sessions of untouched users")
		})
	}
}

func TestServiceSessionSurvivesRestart(t *testing.T) {
	// arrange
	cfg := Config{Users: "alice:" + testHash, SecretFile: filepath.Join(t.TempDir(), "secret")}
	before, err := NewService(cfg)
	require.NoError(t, err)
	value := issue(t, before, "alice")

	// act
	after, err := NewService(cfg)
	require.NoError(t, err)
	tok, ok := after.parse(value, time.Now())

	// assert
	require.True(t, ok)
	assert.Equal(t, "alice", tok.user)
}

func TestLoadSecret(t *testing.T) {
	t.Run("configured secret is hashed into a key", func(t *testing.T) {
		want := sha256.Sum256([]byte(testSecret))
		assert.Equal(t, want[:], loadSecret(testSecret, ""))
	})

	t.Run("a short secret still yields a full key", func(t *testing.T) {
		assert.Len(t, loadSecret("short", ""), secretLen)
	})

	t.Run("without a file the key stays in memory", func(t *testing.T) {
		assert.NotEqual(t, loadSecret("", ""), loadSecret("", ""))
	})

	t.Run("file is created and reused", func(t *testing.T) {
		// arrange
		dir := t.TempDir()
		path := filepath.Join(dir, "nested", "secret")

		// act
		first := loadSecret("", path)
		second := loadSecret("", path)

		// assert
		info, err := os.Stat(path)
		require.NoError(t, err)
		assert.Equal(t, fs.FileMode(secretFileMode), info.Mode().Perm())
		assert.Len(t, first, secretLen)
		assert.Equal(t, first, second)

		entries, err := os.ReadDir(filepath.Dir(path))
		require.NoError(t, err)
		assert.Len(t, entries, 1, "the temp file of the atomic write must be gone")
	})

	t.Run("unusable file is replaced", func(t *testing.T) {
		tests := []struct {
			name    string
			content string
		}{
			{name: "empty", content: ""},
			{name: "not hex", content: "not a key at all\n"},
			{name: "too short", content: "0011223344556677\n"},
		}

		for _, tc := range tests {
			t.Run(tc.name, func(t *testing.T) {
				// arrange
				path := filepath.Join(t.TempDir(), "secret")
				require.NoError(t, os.WriteFile(path, []byte(tc.content), secretFileMode))

				// act
				key := loadSecret("", path)

				// assert
				assert.Len(t, key, secretLen)
				assert.Equal(t, key, loadSecret("", path))
			})
		}
	})

	t.Run("unwritable path falls back to memory", func(t *testing.T) {
		// arrange
		dir := t.TempDir()
		blocker := filepath.Join(dir, "blocker")
		require.NoError(t, os.WriteFile(blocker, []byte("x"), 0o600))
		path := filepath.Join(blocker, "secret")

		// act
		key := loadSecret("", path)

		// assert
		assert.Len(t, key, secretLen)
		assert.NotEqual(t, key, loadSecret("", path))
	})

	t.Run("a world readable file is still used", func(t *testing.T) {
		// arrange
		path := filepath.Join(t.TempDir(), "secret")
		key := loadSecret("", path)
		require.NoError(t, os.Chmod(path, 0o644))

		// act & assert
		assert.Equal(t, key, loadSecret("", path))
	})
}

func TestWriteSecretFile(t *testing.T) {
	// arrange
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "blocker"), []byte("x"), 0o600))

	// act
	err := writeSecretFile(filepath.Join(dir, "blocker", "secret"), randomSecret())

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "create directory")
}

func TestServiceSetSignInCookie(t *testing.T) {
	user := "алиса smith"
	tests := []struct {
		name   string
		secure string
		names  []string
	}{
		{name: "secure request sets both names", secure: SecureAlways,
			names: []string{SecureSignInCookieName, SignInCookieName}},
		{name: "plain request sets the plain name", secure: SecureNever, names: []string{SignInCookieName}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			svc := newTestService(t, Config{Secure: tc.secure})
			rec := httptest.NewRecorder()

			// act
			svc.SetSignInCookie(rec, httptest.NewRequest(http.MethodGet, "/", http.NoBody), user)

			// assert
			res := rec.Result()
			defer res.Body.Close()
			got := make([]string, 0, len(res.Cookies()))
			for _, cookie := range res.Cookies() {
				got = append(got, cookie.Name)
				assert.Equal(t, url.QueryEscape(user), cookie.Value)
				assert.Equal(t, "/", cookie.Path)
				assert.False(t, cookie.HttpOnly)
				assert.Equal(t, tc.secure == SecureAlways, cookie.Secure)
				assert.Equal(t, http.SameSiteLaxMode, cookie.SameSite)
				assert.Zero(t, cookie.MaxAge)
			}
			assert.Equal(t, tc.names, got)
		})
	}
}

func TestServiceSessionCookieName(t *testing.T) {
	tests := []struct {
		name   string
		secure string
		want   string
	}{
		{name: "secure", secure: SecureAlways, want: SecureCookieName},
		{name: "plain", secure: SecureNever, want: CookieName},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			svc := newTestService(t, Config{Secure: tc.secure})
			issued := httptest.NewRecorder()
			cleared := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodGet, "/", http.NoBody)

			// act
			require.NoError(t, svc.SetCookie(issued, r, "alice"))
			svc.ClearCookie(cleared, r)

			// assert
			issuedRes := issued.Result()
			defer issuedRes.Body.Close()
			clearedRes := cleared.Result()
			defer clearedRes.Body.Close()
			require.Len(t, issuedRes.Cookies(), 1)
			require.Len(t, clearedRes.Cookies(), 1)
			assert.Equal(t, tc.want, issuedRes.Cookies()[0].Name)
			assert.Equal(t, tc.secure == SecureAlways, issuedRes.Cookies()[0].Secure)
			assert.Equal(t, tc.want, clearedRes.Cookies()[0].Name)
		})
	}
}

func TestServiceSessionReadsOnlyTheNameOfItsMode(t *testing.T) {
	// arrange
	svc := newTestService(t, Config{TrustedProxy: true})
	value := issue(t, svc, "alice")
	secure := httptest.NewRequest(http.MethodGet, "/", http.NoBody)
	secure.Header.Set("X-Forwarded-Proto", "https")
	secure.AddCookie(&http.Cookie{Name: CookieName, Value: value})
	plain := httptest.NewRequest(http.MethodGet, "/", http.NoBody)
	plain.AddCookie(&http.Cookie{Name: SecureCookieName, Value: value})
	secureOwn := httptest.NewRequest(http.MethodGet, "/", http.NoBody)
	secureOwn.Header.Set("X-Forwarded-Proto", "https")
	secureOwn.AddCookie(&http.Cookie{Name: SecureCookieName, Value: value})
	plainOwn := httptest.NewRequest(http.MethodGet, "/", http.NoBody)
	plainOwn.AddCookie(&http.Cookie{Name: CookieName, Value: value})

	// act
	_, secureOK := svc.session(secure)
	_, plainOK := svc.session(plain)
	_, secureOwnOK := svc.session(secureOwn)
	_, plainOwnOK := svc.session(plainOwn)

	// assert
	assert.False(t, secureOK)
	assert.False(t, plainOK)
	assert.True(t, secureOwnOK)
	assert.True(t, plainOwnOK)
}

func TestServiceSeal(t *testing.T) {
	expiry := time.Now().Add(time.Minute)
	payload := []byte(`{"space":"notes"}`)

	t.Run("round trip", func(t *testing.T) {
		// arrange
		svc := newTestService(t, Config{})

		// act
		user, got, ok := svc.Unseal("app-ticket", svc.Seal("app-ticket", "alice", payload, expiry))

		// assert
		require.True(t, ok)
		assert.Equal(t, "alice", user)
		assert.Equal(t, payload, got)
	})

	t.Run("a purpose cannot open another", func(t *testing.T) {
		// arrange
		svc := newTestService(t, Config{})

		// act
		_, _, ok := svc.Unseal("app-cookie", svc.Seal("app-ticket", "alice", payload, expiry))

		// assert
		assert.False(t, ok)
	})

	t.Run("a sealed value is never a session", func(t *testing.T) {
		// arrange
		svc := newTestService(t, Config{})

		// act
		_, ok := svc.parse(svc.Seal("session", "alice", payload, expiry), svc.now())

		// assert
		assert.False(t, ok)
	})

	t.Run("a session is never a sealed value", func(t *testing.T) {
		// arrange
		svc := newTestService(t, Config{})

		// act
		_, _, ok := svc.Unseal("app-cookie", issue(t, svc, "alice"))

		// assert
		assert.False(t, ok)
	})

	t.Run("expired", func(t *testing.T) {
		// arrange
		svc := newTestService(t, Config{})

		// act
		_, _, ok := svc.Unseal("app-ticket", svc.Seal("app-ticket", "alice", payload, time.Now().Add(-time.Second)))

		// assert
		assert.False(t, ok)
	})

	t.Run("a changed password ends it", func(t *testing.T) {
		// arrange
		before := newTestService(t, Config{Users: "alice:" + testHash})
		after := newTestService(t, Config{Users: "alice:" + mustHash("another", bcrypt.MinCost)})

		// act
		_, _, ok := after.Unseal("app-cookie", before.Seal("app-cookie", "alice", payload, expiry))

		// assert
		assert.False(t, ok)
	})

	t.Run("a removed user ends it", func(t *testing.T) {
		// arrange
		before := newTestService(t, Config{Users: "alice:" + testHash + ",bob:" + testHash})
		after := newTestService(t, Config{Users: "bob:" + testHash})

		// act
		_, _, ok := after.Unseal("app-cookie", before.Seal("app-cookie", "alice", payload, expiry))

		// assert
		assert.False(t, ok)
	})

	t.Run("a tampered payload", func(t *testing.T) {
		// arrange
		svc := newTestService(t, Config{})
		parts := strings.Split(svc.Seal("app-cookie", "alice", payload, expiry), tokenSep)
		parts[2] = b64.EncodeToString([]byte(`{"space":"other"}`))

		// act
		_, _, ok := svc.Unseal("app-cookie", strings.Join(parts, tokenSep))

		// assert
		assert.False(t, ok)
	})

	t.Run("auth disabled seals with a key of its own", func(t *testing.T) {
		// arrange
		svc := newTestService(t, Config{Disabled: true})

		// act
		user, got, ok := svc.Unseal("app-cookie", svc.Seal("app-cookie", "", payload, expiry))

		// assert
		require.True(t, ok)
		assert.Empty(t, user)
		assert.Equal(t, payload, got)
		assert.Len(t, svc.secret, secretLen)
	})

	t.Run("ttl", func(t *testing.T) {
		// arrange
		svc := newTestService(t, Config{TTL: 3 * time.Hour})

		// act & assert
		assert.Equal(t, 3*time.Hour, svc.TTL())
	})
}

func TestServiceUnsealRefusesMalformed(t *testing.T) {
	svc := newTestService(t, Config{})
	user := b64.EncodeToString([]byte("alice"))
	expiry := strconv.FormatInt(time.Now().Add(time.Minute).Unix(), 10)
	payload := b64.EncodeToString([]byte(`{}`))
	signed := func(body string) string {
		return body + tokenSep + b64.EncodeToString(svc.sealMAC("app-ticket", body, "alice"))
	}
	tests := []struct {
		name  string
		value string
	}{
		{name: "empty"},
		{name: "too few parts", value: strings.Join([]string{user, expiry, payload}, tokenSep)},
		{name: "too many parts", value: signed(strings.Join([]string{user, expiry, payload}, tokenSep)) + tokenSep + "x"},
		{name: "a user that is not base64", value: signed(strings.Join([]string{"!", expiry, payload}, tokenSep))},
		{name: "a mac that is not base64", value: strings.Join([]string{user, expiry, payload, "!"}, tokenSep)},
		{name: "an expiry that is not a number", value: signed(strings.Join([]string{user, "soon", payload}, tokenSep))},
		{name: "a payload that is not base64", value: signed(strings.Join([]string{user, expiry, "!"}, tokenSep))},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			gotUser, gotPayload, ok := svc.Unseal("app-ticket", tc.value)

			// assert
			assert.False(t, ok)
			assert.Empty(t, gotUser)
			assert.Nil(t, gotPayload)
		})
	}
}
