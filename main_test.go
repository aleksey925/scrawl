package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/aleksey925/scrawl/auth"
	"github.com/aleksey925/scrawl/history"
	"github.com/aleksey925/scrawl/search"
	"github.com/aleksey925/scrawl/server"
	"github.com/aleksey925/scrawl/store"
)

func TestParseOptsDefaults(t *testing.T) {
	// act
	opts, err := parseOpts(nil)

	// assert
	require.NoError(t, err)
	assert.Equal(t, "/notes", opts.Root)
	assert.Equal(t, ":7272", opts.Listen)
	assert.Equal(t, "Notes", opts.Title)
	assert.Equal(t, byteSize(20<<20), opts.MaxUpload)
	assert.Equal(t, 720*time.Hour, opts.Auth.TTL)
	assert.Equal(t, 5*time.Second, opts.Timeouts.ReadHeader)
	assert.False(t, opts.ReadOnly)
	assert.False(t, opts.Auth.Disabled)
	assert.Empty(t, opts.Exclude)
	assert.Equal(t, "auto", opts.Watch)
	assert.Equal(t, time.Minute, opts.Rescan)
	assert.Equal(t, historyAuto, opts.History)
	assert.Equal(t, "/data/session.key", opts.Auth.SecretFile)
	assert.Equal(t, "auto", opts.Auth.Secure)
}

func TestParseOptsFlags(t *testing.T) {
	// act
	opts, err := parseOpts([]string{
		"--root=/data", "--listen=:9000", "--title=Wiki", "--read-only",
		"--exclude=vendor", "--exclude=dist", "--max-upload=512K", "--trusted-proxy",
		"--watch=poll", "--rescan=10s", "--history=off",
		"--auth.users=bob:secret", "--auth.users=alice:$2a$10$hash",
		"--auth.tokens=bot:sha256:abc", "--auth.tokens=reader:plain:ro",
		"--auth.secret=cookie-key", "--auth.secret-file=/state/key", "--auth.secure=always",
		"--auth.ttl=1h", "--dbg",
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
	assert.Equal(t, []string{"bot:sha256:abc", "reader:plain:ro"}, opts.Auth.Tokens)
	assert.Equal(t, "cookie-key", opts.Auth.Secret)
	assert.Equal(t, time.Hour, opts.Auth.TTL)
	assert.Equal(t, "poll", opts.Watch)
	assert.Equal(t, 10*time.Second, opts.Rescan)
	assert.Equal(t, historyOff, opts.History)
	assert.Equal(t, "/state/key", opts.Auth.SecretFile)
	assert.Equal(t, "always", opts.Auth.Secure)
}

func TestParseOptsEnv(t *testing.T) {
	// arrange
	t.Setenv("ROOT", "/env-root")
	t.Setenv("LISTEN", ":7000")
	t.Setenv("TITLE", "Env Notes")
	t.Setenv("READ_ONLY", "true")
	t.Setenv("EXCLUDE", "tmp,cache")
	t.Setenv("MAX_UPLOAD", "1G")
	t.Setenv("TRUSTED_PROXY", "true")
	t.Setenv("AUTH_USERS", "bob:pass,alice:pass2")
	t.Setenv("AUTH_TOKENS", "bot:sha256:abc,reader:plain:ro")
	t.Setenv("AUTH_SECRET", "env-key")
	t.Setenv("AUTH_TTL", "48h")
	t.Setenv("AUTH_DISABLED", "true")
	t.Setenv("AUTH_SECRET_FILE", "/state/key")
	t.Setenv("AUTH_SECURE", "never")
	t.Setenv("WATCH", "poll")
	t.Setenv("RESCAN", "-1s")
	t.Setenv("HISTORY", "on")
	t.Setenv("TIMEOUT_SHUTDOWN", "9s")
	t.Setenv("DEBUG", "true")

	// act
	opts, err := parseOpts(nil)

	// assert
	require.NoError(t, err)
	assert.Equal(t, "/env-root", opts.Root)
	assert.Equal(t, ":7000", opts.Listen)
	assert.Equal(t, "Env Notes", opts.Title)
	assert.True(t, opts.ReadOnly)
	assert.True(t, opts.TrustedProxy)
	assert.True(t, opts.Dbg)
	assert.Equal(t, []string{"tmp", "cache"}, opts.Exclude)
	assert.Equal(t, byteSize(1<<30), opts.MaxUpload)
	assert.Equal(t, []string{"bob:pass", "alice:pass2"}, opts.Auth.Users)
	assert.Equal(t, []string{"bot:sha256:abc", "reader:plain:ro"}, opts.Auth.Tokens)
	assert.Equal(t, "env-key", opts.Auth.Secret)
	assert.Equal(t, 48*time.Hour, opts.Auth.TTL)
	assert.True(t, opts.Auth.Disabled)
	assert.Equal(t, 9*time.Second, opts.Timeouts.Shutdown)
	assert.Equal(t, "/state/key", opts.Auth.SecretFile)
	assert.Equal(t, "never", opts.Auth.Secure)
	assert.Equal(t, "poll", opts.Watch)
	assert.Equal(t, -time.Second, opts.Rescan)
	assert.Equal(t, historyOn, opts.History)
}

func TestParseOptsInvalid(t *testing.T) {
	tests := []struct {
		name string
		args []string
	}{
		{name: "unknown flag", args: []string{"--no-such-flag"}},
		{name: "unknown watch mode", args: []string{"--watch=inotify"}},
		{name: "unknown history mode", args: []string{"--history=maybe"}},
		{name: "unknown secure mode", args: []string{"--auth.secure=sometimes"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			_, err := parseOpts(tc.args)

			// assert
			require.Error(t, err)
			assert.Contains(t, err.Error(), "parse flags")
		})
	}
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
	const password = "s3cret-pa$$word"

	tests := []struct {
		name  string
		value string
		stdin string
	}{
		{name: "as the flag value", value: password},
		{name: "from stdin", value: "-", stdin: password + "\n"},
		{name: "from stdin without a newline", value: "-", stdin: password},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			hash, err := genHash(tc.value, strings.NewReader(tc.stdin))

			// assert
			require.NoError(t, err)
			assert.NoError(t, bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)))
			assert.Error(t, bcrypt.CompareHashAndPassword([]byte(hash), []byte("wrong")))
		})
	}
}

func TestGenHashRefusesAnEmptyPassword(t *testing.T) {
	// act
	_, err := genHash("-", strings.NewReader("\n"))

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no password on stdin")
}

func TestGenToken(t *testing.T) {
	// act
	token, entry := splitGenToken(t, genToken("bot"))
	other, _ := splitGenToken(t, genToken("bot"))

	// assert
	assert.NotEqual(t, token, other)
	assert.Equal(t, "bot:"+auth.TokenDigest(token), entry)
	assert.NotContains(t, entry, token, "the entry must carry the digest only")
}

func TestGenTokenEntryAcceptsThePrintedToken(t *testing.T) {
	// arrange
	token, entry := splitGenToken(t, genToken("bot"))
	svc, err := auth.NewService(auth.Config{Tokens: entry, Secret: "0123456789abcdef"})
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodGet, "/api/tree", http.NoBody)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	// act
	svc.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, _ := svc.User(r)
		_, _ = w.Write([]byte(user))
	})).ServeHTTP(rec, req)

	// assert
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "bot", rec.Body.String())
}

// splitGenToken reads the two labeled lines back: the token, then the entry.
func splitGenToken(t *testing.T, out string) (token, entry string) {
	t.Helper()
	lines := strings.Split(out, "\n")
	require.Len(t, lines, 2)
	for _, line := range lines {
		require.NotEmpty(t, strings.Fields(line))
	}
	return lastField(lines[0]), lastField(lines[1])
}

func lastField(line string) string {
	fields := strings.Fields(line)
	return fields[len(fields)-1]
}

func TestValidateGlobal(t *testing.T) {
	tests := []struct {
		name    string
		users   []string
		tokens  []string
		noAuth  bool
		errText string
	}{
		{name: "ok with users", users: []string{"bob:pass"}},
		{name: "ok with tokens and no users", tokens: []string{"bot:sha256:abc"}},
		{name: "ok with auth disabled", noAuth: true},
		{name: "no users and no tokens", errText: "no users and no tokens configured"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			opts := &options{}
			opts.Auth.Users = tc.users
			opts.Auth.Tokens = tc.tokens
			opts.Auth.Disabled = tc.noAuth

			// act
			err := validateGlobal(opts)

			// assert
			if tc.errText != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.errText)
				return
			}
			require.NoError(t, err)
		})
	}
}

func TestValidateProjects(t *testing.T) {
	dir := t.TempDir()

	tests := []struct {
		name    string
		cfgs    []projectConfig
		errText string
	}{
		{name: "one named project", cfgs: []projectConfig{{Name: "notes", Dir: dir}}},
		{name: "none at all", errText: "no project configured"},
		{name: "no name", cfgs: []projectConfig{{Dir: dir}}, errText: "every project needs a name"},
		{
			name:    "name is not a slug",
			cfgs:    []projectConfig{{Name: "My Notes", Dir: dir}},
			errText: "must be a url slug",
		},
		{name: "no directory", cfgs: []projectConfig{{Name: "notes"}}, errText: "has no directory"},
		{
			name:    "two of the same name",
			cfgs:    []projectConfig{{Name: "notes", Dir: dir}, {Name: "notes", Dir: t.TempDir()}},
			errText: `two projects are named "notes"`,
		},
		{
			name:    "one root inside the other",
			cfgs:    []projectConfig{{Name: "outer", Dir: dir}, {Name: "inner", Dir: filepath.Join(dir, "sub")}},
			errText: "overlap",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			err := validateProjects(t.Context(), tc.cfgs)

			// assert
			if tc.errText != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.errText)
				return
			}
			require.NoError(t, err)
		})
	}
}

func TestResolveRoots(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "page.md")
	require.NoError(t, os.WriteFile(file, []byte("# page"), 0o600))

	tests := []struct {
		name    string
		cfgs    []projectConfig
		errText string
	}{
		{name: "a directory", cfgs: []projectConfig{{Name: "notes", Dir: dir}}},
		{name: "missing", cfgs: []projectConfig{{Name: "notes", Dir: filepath.Join(dir, "nope")}}, errText: "no such file"},
		{name: "a file", cfgs: []projectConfig{{Name: "notes", Dir: file}}, errText: "is not a directory"},
		{
			name:    "the same directory spelled two ways",
			cfgs:    []projectConfig{{Name: "one", Dir: dir}, {Name: "two", Dir: filepath.Join(dir, "sub", "..")}},
			errText: "overlap",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			roots, err := resolveRoots(tc.cfgs)

			// assert
			if tc.errText != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.errText)
				return
			}
			require.NoError(t, err)
			resolved, evalErr := filepath.EvalSymlinks(dir)
			require.NoError(t, evalErr)
			assert.Equal(t, []string{resolved}, roots)
		})
	}
}

func TestCheckSecretFile(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()

	tests := []struct {
		name    string
		file    string
		noAuth  bool
		refused bool
	}{
		{name: "outside every root", file: filepath.Join(t.TempDir(), "session.key")},
		{name: "default location", file: "/data/session.key"},
		{name: "not set", file: ""},
		{name: "inside the first root", file: filepath.Join(root, "session.key"), refused: true},
		{name: "inside the second root", file: filepath.Join(other, "session.key"), refused: true},
		{name: "deep inside a root", file: filepath.Join(root, "sub", "session.key"), refused: true},
		{name: "inside a root but auth is off", file: filepath.Join(root, "session.key"), noAuth: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			opts := &options{}
			opts.Auth.SecretFile = tc.file
			opts.Auth.Disabled = tc.noAuth

			// act
			err := checkSecretFile([]string{root, other}, opts)

			// assert
			if tc.refused {
				require.Error(t, err)
				assert.Contains(t, err.Error(), "must live outside the notes root")
				return
			}
			require.NoError(t, err)
		})
	}
}

func TestNewHistory(t *testing.T) {
	t.Run("off leaves the notes directory alone", func(t *testing.T) {
		// arrange
		root := t.TempDir()

		// act
		hist, err := newHistory(&options{History: historyOff}, projectConfig{Name: "notes"}, notesAt(t, root))

		// assert
		require.NoError(t, err)
		assert.False(t, hist.Enabled())
		assert.NoDirExists(t, filepath.Join(root, ".git"))
	})

	t.Run("auto initializes a repository", func(t *testing.T) {
		// arrange
		requireGit(t)
		root := t.TempDir()

		// act
		hist, err := newHistory(&options{History: historyAuto}, projectConfig{Name: "notes"}, notesAt(t, root))

		// assert
		require.NoError(t, err)
		t.Cleanup(func() { assert.NoError(t, hist.Close()) })
		assert.True(t, hist.Enabled())
		// the service canonicalizes its root, so the comparison has to start
		// from the same place: on macOS a temp directory lives under /var,
		// which is a symlink to /private/var
		resolved, err := filepath.EvalSymlinks(root)
		require.NoError(t, err)
		assert.Equal(t, resolved, hist.Root())
	})

	t.Run("auto carries on when the root is inside another repository", func(t *testing.T) {
		// arrange
		root := gitChild(t)

		// act
		hist, err := newHistory(&options{History: historyAuto}, projectConfig{Name: "notes"}, notesAt(t, root))

		// assert
		require.NoError(t, err)
		assert.False(t, hist.Enabled())
		assert.NoDirExists(t, filepath.Join(root, ".git"))
	})

	t.Run("on refuses to start when the root is inside another repository", func(t *testing.T) {
		// arrange
		root := gitChild(t)

		// act
		hist, err := newHistory(&options{History: historyOn}, projectConfig{Name: "notes"}, notesAt(t, root))

		// assert
		require.ErrorIs(t, err, history.ErrInsideRepo)
		assert.False(t, hist.Enabled())
	})
}

func TestReconcileImportsWhatTheStoreShows(t *testing.T) {
	// arrange
	requireGit(t)
	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, "page.md"), []byte("# page\n"), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(root, "notes.txt"), []byte("plain\n"), 0o600))
	hist, err := newHistory(&options{History: historyOn}, projectConfig{Name: "notes"}, notesAt(t, root))
	require.NoError(t, err)
	t.Cleanup(func() { assert.NoError(t, hist.Close()) })

	// act
	reconcile(t.Context(), "notes", hist, historyActorStartup)

	// assert
	entries, err := hist.Log(t.Context(), "page.md", 0)
	require.NoError(t, err)
	require.Len(t, entries, 1)
	assert.Equal(t, historyActorStartup, entries[0].Actor)

	plain, err := hist.Log(t.Context(), "notes.txt", 0)
	require.NoError(t, err)
	assert.Empty(t, plain, "only the versioned extensions are imported")
}

func notesAt(t *testing.T, root string) *store.Store {
	t.Helper()
	notes, err := store.New(store.Config{Root: root, Rescan: -1})
	require.NoError(t, err)
	t.Cleanup(func() { _ = notes.Close() })
	return notes
}

func requireGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
}

// gitChild is a notes directory that sits inside somebody else's repository.
func gitChild(t *testing.T) string {
	t.Helper()
	requireGit(t)

	parent := t.TempDir()
	cmd := exec.CommandContext(t.Context(), "git", "init", "--quiet", parent)
	// the same environment the service gives its own git calls: a host without
	// a global or system config is one git refuses to run in otherwise
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null", "LC_ALL=C")
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "git init: %s", out)

	root := filepath.Join(parent, "notes")
	require.NoError(t, os.Mkdir(root, 0o750))
	return root
}

func TestIndexAll(t *testing.T) {
	// arrange
	notes, err := store.New(store.Config{Root: "./examples/data", Rescan: -1})
	require.NoError(t, err)
	t.Cleanup(func() { _ = notes.Close() })
	index := search.New()

	// act
	err = indexAll("notes", notes, index)

	// assert
	require.NoError(t, err)
	assert.Positive(t, index.Len())
	assert.Positive(t, index.Size())
}

func TestWatchStopsWithTheContext(t *testing.T) {
	// arrange
	notes, err := store.New(store.Config{Root: t.TempDir(), Watch: store.WatchPoll, Rescan: 20 * time.Millisecond})
	require.NoError(t, err)
	t.Cleanup(func() { _ = notes.Close() })

	ctx, cancel := context.WithCancel(t.Context())
	done := watch(ctx, &runtimeProject{web: &server.Project{Name: "notes"}, notes: notes, index: search.New()}, &server.Web{})

	// act
	cancel()

	// assert
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the watcher goroutine outlived its context")
	}
}

func TestWatchKeepsTheIndexInStep(t *testing.T) {
	// arrange
	root := t.TempDir()
	page := filepath.Join(root, "page.md")
	require.NoError(t, os.WriteFile(page, []byte("# Page\n"), 0o600))

	notes, err := store.New(store.Config{Root: root, Watch: store.WatchPoll, Rescan: 20 * time.Millisecond})
	require.NoError(t, err)
	t.Cleanup(func() { _ = notes.Close() })

	index := search.New()
	index.Set("page.md", []byte("# Page\n"))
	ctx, cancel := context.WithCancel(t.Context())
	done := watch(ctx, &runtimeProject{web: &server.Project{Name: "notes"}, notes: notes, index: index}, &server.Web{})

	// act & assert
	require.NoError(t, os.WriteFile(page, []byte("# Page\n\nkumquat\n"), 0o600))
	assert.Eventually(t, func() bool { return len(index.Search("kumquat", 5)) == 1 },
		5*time.Second, 20*time.Millisecond, "an edited file never reached the index")

	require.NoError(t, os.Remove(page))
	assert.Eventually(t, func() bool { return index.Len() == 0 },
		5*time.Second, 20*time.Millisecond, "a removed file stayed in the index")

	cancel()
	<-done
}

func TestSecretsOf(t *testing.T) {
	// arrange
	opts := &options{}
	opts.Auth.Secret = "cookie-key"
	opts.Auth.Users = []string{"bob:pass", "nameless-password", "empty:"}
	opts.Auth.Tokens = []string{"bot:plain-token:ro", "scrawl_nameless-token", "empty:"}

	// act
	secrets := secretsOf(opts, nil)

	// assert
	assert.Equal(t, []string{
		"cookie-key", "pass", "nameless-password", "plain-token:ro", "scrawl_nameless-token",
	}, secrets)
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
	// examples/data lives inside this repository, so history would initialize a
	// nested one right in the source tree
	opts, err := parseOpts([]string{
		"--root=./examples/data", "--project=notes", "--listen=" + addr, "--auth.disabled", "--history=off", "--dbg",
	})
	require.NoError(t, err)

	setupLog(opts.Dbg)

	ctx, cancel := context.WithCancel(t.Context())
	errCh := make(chan error, 1)
	go func() { errCh <- run(ctx, opts, projectsFrom(t, opts)) }()

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

func TestRunRefusesAServerWithNoProjectName(t *testing.T) {
	// arrange
	opts, err := parseOpts([]string{"--root=./examples/data", "--auth.disabled"})
	require.NoError(t, err)

	// act
	err = run(t.Context(), opts, projectsFrom(t, opts))

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "every project needs a name")
}

func TestRunValidationFailure(t *testing.T) {
	// arrange
	opts, err := parseOpts([]string{"--root=/definitely/not/here", "--project=notes", "--auth.disabled"})
	require.NoError(t, err)

	// act
	err = run(t.Context(), opts, projectsFrom(t, opts))

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no such file")
}

// projectsFrom builds the project list run takes, the way main does.
func projectsFrom(t *testing.T, opts *options) []projectConfig {
	t.Helper()
	cfgs, err := loadConfig(opts)
	require.NoError(t, err)
	return cfgs
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
