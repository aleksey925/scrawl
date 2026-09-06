package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

func TestParseOptsDefaults(t *testing.T) {
	// act
	opts, err := parseOpts(nil)

	// assert
	require.NoError(t, err)
	assert.Equal(t, "/kb", opts.Root)
	assert.Equal(t, ":8080", opts.Listen)
	assert.Equal(t, "Knowledge Base", opts.Title)
	assert.Equal(t, byteSize(20<<20), opts.MaxUpload)
	assert.Equal(t, 720*time.Hour, opts.Auth.TTL)
	assert.Equal(t, 5*time.Second, opts.Timeouts.ReadHeader)
	assert.False(t, opts.ReadOnly)
	assert.False(t, opts.Auth.Disabled)
	assert.Empty(t, opts.Exclude)
}

func TestParseOptsFlags(t *testing.T) {
	// act
	opts, err := parseOpts([]string{
		"--root=/data", "--listen=:9000", "--title=Wiki", "--read-only",
		"--exclude=vendor", "--exclude=dist", "--max-upload=512K", "--trusted-proxy",
		"--auth.users=bob:secret", "--auth.users=alice:$2a$10$hash",
		"--auth.secret=cookie-key", "--auth.ttl=1h", "--dbg",
	})

	// assert
	require.NoError(t, err)
	assert.Equal(t, "/data", opts.Root)
	assert.Equal(t, ":9000", opts.Listen)
	assert.Equal(t, "Wiki", opts.Title)
	assert.True(t, opts.ReadOnly)
	assert.True(t, opts.TrustedProxy)
	assert.True(t, opts.Dbg)
	assert.Equal(t, []string{"vendor", "dist"}, opts.Exclude)
	assert.Equal(t, byteSize(512<<10), opts.MaxUpload)
	assert.Equal(t, []string{"bob:secret", "alice:$2a$10$hash"}, opts.Auth.Users)
	assert.Equal(t, "cookie-key", opts.Auth.Secret)
	assert.Equal(t, time.Hour, opts.Auth.TTL)
}

func TestParseOptsEnv(t *testing.T) {
	// arrange
	t.Setenv("ROOT", "/env-root")
	t.Setenv("LISTEN", ":7000")
	t.Setenv("TITLE", "Env KB")
	t.Setenv("READ_ONLY", "true")
	t.Setenv("EXCLUDE", "tmp,cache")
	t.Setenv("MAX_UPLOAD", "1G")
	t.Setenv("TRUSTED_PROXY", "true")
	t.Setenv("AUTH_USERS", "bob:pass,alice:pass2")
	t.Setenv("AUTH_SECRET", "env-key")
	t.Setenv("AUTH_TTL", "48h")
	t.Setenv("AUTH_DISABLED", "true")
	t.Setenv("TIMEOUT_SHUTDOWN", "9s")
	t.Setenv("DEBUG", "true")

	// act
	opts, err := parseOpts(nil)

	// assert
	require.NoError(t, err)
	assert.Equal(t, "/env-root", opts.Root)
	assert.Equal(t, ":7000", opts.Listen)
	assert.Equal(t, "Env KB", opts.Title)
	assert.True(t, opts.ReadOnly)
	assert.True(t, opts.TrustedProxy)
	assert.True(t, opts.Dbg)
	assert.Equal(t, []string{"tmp", "cache"}, opts.Exclude)
	assert.Equal(t, byteSize(1<<30), opts.MaxUpload)
	assert.Equal(t, []string{"bob:pass", "alice:pass2"}, opts.Auth.Users)
	assert.Equal(t, "env-key", opts.Auth.Secret)
	assert.Equal(t, 48*time.Hour, opts.Auth.TTL)
	assert.True(t, opts.Auth.Disabled)
	assert.Equal(t, 9*time.Second, opts.Timeouts.Shutdown)
}

func TestParseOptsInvalid(t *testing.T) {
	// act
	_, err := parseOpts([]string{"--no-such-flag"})

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "parse flags")
}

func TestByteSizeUnmarshalFlag(t *testing.T) {
	tests := []struct {
		name     string
		value    string
		expected byteSize
		wantErr  bool
	}{
		{name: "plain number", value: "1024", expected: 1024},
		{name: "bytes suffix", value: "700B", expected: 700},
		{name: "kilobytes", value: "512K", expected: 512 << 10},
		{name: "kilobytes long", value: "512kb", expected: 512 << 10},
		{name: "megabytes", value: "20M", expected: 20 << 20},
		{name: "gigabytes", value: "2G", expected: 2 << 30},
		{name: "spaces trimmed", value: " 4M ", expected: 4 << 20},
		{name: "empty", value: "", wantErr: true},
		{name: "garbage", value: "big", wantErr: true},
		{name: "negative", value: "-1M", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			var size byteSize

			// act
			err := size.UnmarshalFlag(tc.value)

			// assert
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.expected, size)
		})
	}
}

func TestGenHash(t *testing.T) {
	// arrange
	const password = "s3cret-pa$$word"

	// act
	hash, err := genHash(password)

	// assert
	require.NoError(t, err)
	assert.NoError(t, bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)))
	assert.Error(t, bcrypt.CompareHashAndPassword([]byte(hash), []byte("wrong")))
}

func TestValidate(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "page.md")
	require.NoError(t, os.WriteFile(file, []byte("# page"), 0o600))

	tests := []struct {
		name    string
		root    string
		users   []string
		noAuth  bool
		errText string
	}{
		{name: "ok with users", root: dir, users: []string{"bob:pass"}},
		{name: "ok with auth disabled", root: dir, noAuth: true},
		{name: "missing root", root: filepath.Join(dir, "nope"), noAuth: true, errText: "root directory"},
		{name: "root is a file", root: file, noAuth: true, errText: "is not a directory"},
		{name: "no users", root: dir, errText: "no users configured"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			opts := &options{Root: tc.root}
			opts.Auth.Users = tc.users
			opts.Auth.Disabled = tc.noAuth

			// act
			root, err := validate(opts)

			// assert
			if tc.errText != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.errText)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, dir, root)
		})
	}
}

func TestPlainPasswordUsers(t *testing.T) {
	// arrange
	hash, err := genHash("hashed")
	require.NoError(t, err)
	users := []string{"bob:plain", "alice:" + hash, "no-colon", "empty:"}

	// act
	plain := plainPasswordUsers(users)

	// assert
	assert.Equal(t, []string{"bob", "empty"}, plain)
}

func TestSecretsOf(t *testing.T) {
	// arrange
	opts := &options{}
	opts.Auth.Secret = "cookie-key"
	opts.Auth.Users = []string{"bob:pass", "broken-entry", "empty:"}

	// act
	secrets := secretsOf(opts)

	// assert
	assert.Equal(t, []string{"cookie-key", "pass"}, secrets)
}

func TestVersionInfo(t *testing.T) {
	// arrange
	original := revision
	t.Cleanup(func() { revision = original })
	revision = "v1.0.0-abc"

	// act & assert
	assert.Equal(t, "v1.0.0-abc", versionInfo())
}

func TestRunSmoke(t *testing.T) {
	// arrange
	addr := fmt.Sprintf("127.0.0.1:%d", freePort(t))
	opts, err := parseOpts([]string{"--root=./testdata/kb", "--listen=" + addr, "--auth.disabled", "--dbg"})
	require.NoError(t, err)

	setupLog(opts.Dbg)

	ctx, cancel := context.WithCancel(t.Context())
	errCh := make(chan error, 1)
	go func() { errCh <- run(ctx, opts) }()

	// act
	status := pingStatus(t, "http://"+addr+"/ping")
	cancel()

	// assert
	assert.Equal(t, http.StatusOK, status)
	select {
	case err := <-errCh:
		assert.NoError(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("server did not stop in time")
	}
}

func TestRunValidationFailure(t *testing.T) {
	// arrange
	opts, err := parseOpts([]string{"--root=/definitely/not/here", "--auth.disabled"})
	require.NoError(t, err)

	// act
	err = run(t.Context(), opts)

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "root directory")
}

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	port := ln.Addr().(*net.TCPAddr).Port
	require.NoError(t, ln.Close())
	return port
}

func pingStatus(t *testing.T, url string) int {
	t.Helper()
	var lastErr error
	for range 100 {
		req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, url, http.NoBody)
		require.NoError(t, err)
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			status := resp.StatusCode
			require.NoError(t, resp.Body.Close())
			return status
		}
		lastErr = err
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("server never answered on %s: %v", url, lastErr)
	return 0
}
