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
	assert.Equal(t, spaceOptions{Dir: defaultSpaceDir, FormatOnSave: formatOn}, opts.Space)
	assert.Equal(t, ":7272", opts.Listen)
	assert.Equal(t, "Notes", opts.SiteTitle)
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
	assert.Empty(t, opts.Apps.URL)
}

func TestParseOptsFlags(t *testing.T) {
	// act
	opts, err := parseOpts([]string{
		"--space.dir=/data", "--listen=:9000", "--site-title=Wiki", "--read-only",
		"--exclude=vendor", "--exclude=dist", "--max-upload=512K", "--trusted-proxy",
		"--watch=poll", "--rescan=10s", "--history=off",
		"--auth.users=bob:secret", "--auth.users=alice:$2a$10$hash",
		"--auth.tokens=bot:sha256:abc", "--auth.tokens=reader:plain:ro",
		"--auth.secret=cookie-key", "--auth.secret-file=/state/key", "--auth.secure=always",
		"--auth.ttl=1h", "--dbg", "--apps.url=https://app-{id}.example.com",
	})

	// assert
	require.NoError(t, err)
	assert.Equal(t, "/data", opts.Space.Dir)
	assert.Equal(t, ":9000", opts.Listen)
	assert.Equal(t, "Wiki", opts.SiteTitle)
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
	assert.Equal(t, "https://app-{id}.example.com", opts.Apps.URL)
}

func TestParseOptsEnv(t *testing.T) {
	// arrange
	t.Setenv("SPACE_NAME", "env-notes")
	t.Setenv("SPACE_DIR", "/env-root")
	t.Setenv("SPACE_FORMAT_ON_SAVE", "off")
	t.Setenv("SPACES_FILE", "/env/spaces.yml")
	t.Setenv("LISTEN", ":7000")
	t.Setenv("SITE_TITLE", "Env Notes")
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
	t.Setenv("APPS_URL", "http://app-{id}.apps.home.lan:7272")

	// act
	opts, err := parseOpts(nil)

	// assert
	require.NoError(t, err)
	assert.Equal(t, spaceOptions{Name: "env-notes", Dir: "/env-root", FormatOnSave: formatOff}, opts.Space)
	assert.Equal(t, "/env/spaces.yml", opts.SpacesFile)
	assert.Equal(t, ":7000", opts.Listen)
	assert.Equal(t, "Env Notes", opts.SiteTitle)
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
	assert.Equal(t, "http://app-{id}.apps.home.lan:7272", opts.Apps.URL)
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
	const (
		noID = "--apps.url (APPS_URL) must have {id} in its first label, such as https://app-{id}.example.com: " +
			"every HTML app runs on a host of its own"
		neverSecure = "--apps.url (APPS_URL) is https, but the session cookie is never Secure, so an HTML app " +
			"could change the sign-in: add --trusted-proxy (TRUSTED_PROXY=true) behind Cloudflare Tunnel or another " +
			"proxy that sets X-Forwarded-Proto, or --auth.secure=always (AUTH_SECURE=always)"
		httpsApps = "https://app-{id}.example.com"
	)
	tests := []struct {
		name         string
		users        []string
		tokens       []string
		noAuth       bool
		appsURL      string
		secure       string
		trustedProxy bool
		errText      string
	}{
		{name: "ok with users", users: []string{"bob:pass"}},
		{name: "ok with tokens and no users", tokens: []string{"bot:sha256:abc"}},
		{name: "ok with auth disabled", noAuth: true},
		{name: "no users and no tokens",
			errText: "no users and no tokens configured, set --auth.users or --auth.tokens, or run with --auth.disabled"},
		{name: "apps url without id", users: []string{"bob:pass"}, appsURL: "https://apps.example.com", errText: noID},
		{name: "apps url without id and auth off", noAuth: true, appsURL: "https://apps.example.com", errText: noID},
		{name: "apps url with two ids", users: []string{"bob:pass"}, appsURL: "https://{id}-{id}.example.com",
			errText: noID},
		{name: "apps url with a path", users: []string{"bob:pass"}, appsURL: "https://app-{id}.example.com/x",
			errText: "--apps.url (APPS_URL) must have no path"},
		{name: "https apps, auto without a trusted proxy", users: []string{"bob:pass"}, appsURL: httpsApps,
			secure: "auto", errText: neverSecure},
		{name: "https apps, never", users: []string{"bob:pass"}, appsURL: httpsApps, secure: "never",
			errText: neverSecure},
		{name: "https apps, never with a trusted proxy", users: []string{"bob:pass"}, appsURL: httpsApps,
			secure: "never", trustedProxy: true, errText: neverSecure},
		{name: "https apps, auto with a trusted proxy", users: []string{"bob:pass"}, appsURL: httpsApps,
			secure: "auto", trustedProxy: true},
		{name: "https apps, always", users: []string{"bob:pass"}, appsURL: httpsApps, secure: "always"},
		{name: "https apps, auth off", noAuth: true, appsURL: httpsApps, secure: "auto"},
		{name: "http apps", users: []string{"bob:pass"}, appsURL: "http://app-{id}.example.com", secure: "auto"},
		{name: "no apps url", users: []string{"bob:pass"}, secure: "never"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			opts := &options{}
			opts.Auth.Users = tc.users
			opts.Auth.Tokens = tc.tokens
			opts.Auth.Disabled = tc.noAuth
			opts.Auth.Secure = tc.secure
			opts.Apps.URL = tc.appsURL
			opts.TrustedProxy = tc.trustedProxy

			// act
			err := validateGlobal(opts)

			// assert
			if tc.errText != "" {
				require.EqualError(t, err, tc.errText)
				return
			}
			require.NoError(t, err)
		})
	}
}

func TestAppsWarning(t *testing.T) {
	const (
		local = "HTML apps run over http: at localhost an HTML app can sign you out or into another account, " +
			"open scrawl at the 127.0.0.1 link printed at start"
		plain = "--apps.url (APPS_URL) is http: an HTML app can sign you out or into another account when scrawl " +
			"and the apps are on neighbor names, such as notes.home.lan and app-x.home.lan, so do not put them " +
			"on neighbor names, or use https"
	)
	tests := []struct {
		name         string
		noAuth       bool
		appsURL      string
		secure       string
		trustedProxy bool
		want         string
	}{
		{name: "auth on, no apps url", want: local},
		{name: "auth on, http apps url", appsURL: "http://app-{id}.home.lan", want: plain},
		{name: "auth on, http apps url with a trusted proxy", appsURL: "http://app-{id}.home.lan",
			trustedProxy: true, want: plain},
		{name: "auth on, http apps url with always", appsURL: "http://app-{id}.home.lan", secure: "always",
			want: plain},
		{name: "auth on, https apps url", appsURL: "https://app-{id}.example.com", trustedProxy: true},
		{name: "auth off, no apps url", noAuth: true},
		{name: "auth off, http apps url", noAuth: true, appsURL: "http://app-{id}.home.lan"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			opts := &options{}
			opts.Auth.Disabled = tc.noAuth
			opts.Auth.Secure = tc.secure
			opts.Apps.URL = tc.appsURL
			opts.TrustedProxy = tc.trustedProxy

			// act
			got := appsWarning(opts)

			// assert
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestValidateSpaces(t *testing.T) {
	dir := t.TempDir()

	tests := []struct {
		name    string
		cfgs    []spaceConfig
		errText string
	}{
		{name: "one named space", cfgs: []spaceConfig{{Name: "notes", Dir: dir}}},
		{name: "none at all", errText: "no space configured"},
		{name: "no name", cfgs: []spaceConfig{{Dir: dir}}, errText: "every space needs a name"},
		{
			name:    "name is not a slug",
			cfgs:    []spaceConfig{{Name: "My Notes", Dir: dir}},
			errText: "must be a url slug",
		},
		{name: "no directory", cfgs: []spaceConfig{{Name: "notes"}}, errText: "has no directory"},
		{
			name:    "two of the same name",
			cfgs:    []spaceConfig{{Name: "notes", Dir: dir}, {Name: "notes", Dir: t.TempDir()}},
			errText: `two spaces are named "notes"`,
		},
		{
			name:    "one root inside the other",
			cfgs:    []spaceConfig{{Name: "outer", Dir: dir}, {Name: "inner", Dir: filepath.Join(dir, "sub")}},
			errText: "overlap",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			err := validateSpaces(t.Context(), tc.cfgs)

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
		cfgs    []spaceConfig
		errText string
	}{
		{name: "a directory", cfgs: []spaceConfig{{Name: "notes", Dir: dir}}},
		{name: "missing", cfgs: []spaceConfig{{Name: "notes", Dir: filepath.Join(dir, "nope")}}, errText: "no such file"},
		{name: "a file", cfgs: []spaceConfig{{Name: "notes", Dir: file}}, errText: "is not a directory"},
		{
			name:    "the same directory spelled two ways",
			cfgs:    []spaceConfig{{Name: "one", Dir: dir}, {Name: "two", Dir: filepath.Join(dir, "sub", "..")}},
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

func TestCheckSecretFiles(t *testing.T) {
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
			err := checkSecretFiles([]string{root, other}, opts, nil)

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
		hist, err := newHistory(&options{History: historyOff}, spaceConfig{Name: "notes"}, notesAt(t, root))

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
		hist, err := newHistory(&options{History: historyAuto}, spaceConfig{Name: "notes"}, notesAt(t, root))

		// assert
		require.NoError(t, err)
		t.Cleanup(func() { assert.NoError(t, hist.Close()) })
		assert.True(t, hist.Enabled())
		resolved, err := filepath.EvalSymlinks(root)
		require.NoError(t, err)
		assert.Equal(t, resolved, hist.Root())
	})

	t.Run("auto carries on when the root is inside another repository", func(t *testing.T) {
		// arrange
		root := gitChild(t)

		// act
		hist, err := newHistory(&options{History: historyAuto}, spaceConfig{Name: "notes"}, notesAt(t, root))

		// assert
		require.NoError(t, err)
		assert.False(t, hist.Enabled())
		assert.NoDirExists(t, filepath.Join(root, ".git"))
	})

	t.Run("on refuses to start when the root is inside another repository", func(t *testing.T) {
		// arrange
		root := gitChild(t)

		// act
		hist, err := newHistory(&options{History: historyOn}, spaceConfig{Name: "notes"}, notesAt(t, root))

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
	hist, err := newHistory(&options{History: historyOn}, spaceConfig{Name: "notes"}, notesAt(t, root))
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

func gitChild(t *testing.T) string {
	t.Helper()
	requireGit(t)

	parent := t.TempDir()
	cmd := exec.CommandContext(t.Context(), "git", "init", "--quiet", parent)
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
	done := watch(ctx, &runtimeSpace{web: &server.Space{Name: "notes"}, notes: notes, index: search.New()}, &server.Web{})

	// act
	cancel()

	// assert
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the watcher goroutine outlived its context")
	}
}

func TestSweepTrashStopsWithTheContext(t *testing.T) {
	// arrange
	notes, err := store.New(store.Config{Root: t.TempDir()})
	require.NoError(t, err)
	t.Cleanup(func() { _ = notes.Close() })

	ctx, cancel := context.WithCancel(t.Context())
	done := sweepTrash(ctx, notes)

	// act
	cancel()

	// assert
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the trash sweep outlived its context")
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
	done := watch(ctx, &runtimeSpace{web: &server.Space{Name: "notes"}, notes: notes, index: index}, &server.Web{})

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
	opts, err := parseOpts([]string{
		"--space.dir=./examples/data", "--space.name=notes", "--listen=" + addr, "--auth.disabled", "--history=off", "--dbg",
	})
	require.NoError(t, err)

	setupLog(opts.Dbg)

	ctx, cancel := context.WithCancel(t.Context())
	errCh := make(chan error, 1)
	go func() { errCh <- run(ctx, opts, spacesFrom(t, opts)) }()

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

func TestRunRefusesAServerWithNoSpaceName(t *testing.T) {
	// arrange
	opts, err := parseOpts([]string{"--space.dir=./examples/data", "--auth.disabled"})
	require.NoError(t, err)

	// act
	err = run(t.Context(), opts, spacesFrom(t, opts))

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "every space needs a name")
}

func TestRunValidationFailure(t *testing.T) {
	// arrange
	opts, err := parseOpts([]string{"--space.dir=/definitely/not/here", "--space.name=notes", "--auth.disabled"})
	require.NoError(t, err)

	// act
	err = run(t.Context(), opts, spacesFrom(t, opts))

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no such file")
}

func spacesFrom(t *testing.T, opts *options) []spaceConfig {
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
