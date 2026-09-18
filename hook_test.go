package main

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/history"
	"github.com/aleksey925/scrawl/server"
)

// aSecret is long enough to pass the minimum, which is the length of
// `openssl rand -hex 32` halved.
const aSecret = "0123456789abcdef0123456789abcdef"

func TestLoadConfigReadsTheHookSecret(t *testing.T) {
	// arrange
	t.Setenv("SCRAWL_TEST_HOOK", aSecret)
	opts := &options{Config: writeConfig(t, `
projects:
  - name: team
    dir: /data/team
    repo:
      url: https://github.com/acme/wiki.git
      branch: main
      hook_secret_env: SCRAWL_TEST_HOOK
`)}

	// act
	cfgs, err := loadConfig(opts)

	// assert
	require.NoError(t, err)
	require.NotNil(t, cfgs[0].Remote)
	assert.Equal(t, aSecret, cfgs[0].Remote.HookSecret)
	_, still := os.LookupEnv("SCRAWL_TEST_HOOK")
	assert.False(t, still, "the variable must not be inherited by the git children either")
}

func TestFlagProjectsReadTheFixedHookVariable(t *testing.T) {
	// arrange
	t.Setenv(repoHookSecretEnv, aSecret)
	opts := &options{Root: "/notes", Project: "notes"}
	opts.Repo.URL = "https://github.com/acme/wiki.git"
	opts.Repo.Branch = "main"

	// act
	cfgs, err := loadConfig(opts)

	// assert
	require.NoError(t, err)
	assert.Equal(t, aSecret, cfgs[0].Remote.HookSecret)
}

func TestLoadConfigRefusesBothHookSources(t *testing.T) {
	// act
	_, err := loadConfig(&options{Config: writeConfig(t, `
projects:
  - name: team
    dir: /data/team
    repo:
      url: https://x/y.git
      branch: main
      hook_secret_file: /run/hook
      hook_secret_env: HOOK
`)})

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "sets both repo.hook_secret_file and repo.hook_secret_env")
}

// the resolver is allowed to return the empty string, because a public https
// remote has no git credential. A hook secret has no such case: the empty
// string is the key anybody can compute with, on a route that needs no session
// and has no rate limiter in front of it. A file that resolves to nothing is a
// secret that failed to mount, which reads the same from here as one that was
// never asked for and must not be served as a silently disabled webhook.
func TestResolveHookSecretRefusesAWeakOne(t *testing.T) {
	tests := []struct {
		name    string
		content string
		errText string
	}{
		{name: "long enough", content: aSecret},
		{name: "an empty file", content: "", errText: "shorter than 32 bytes"},
		{name: "a file holding only a newline", content: "\n", errText: "shorter than 32 bytes"},
		{name: "too short", content: "short", errText: "shorter than 32 bytes"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			file := filepath.Join(t.TempDir(), "hook")
			require.NoError(t, os.WriteFile(file, []byte(tc.content), 0o600))

			// act
			secret, err := resolveHookSecret(file, "")

			// assert
			if tc.errText == "" {
				require.NoError(t, err)
				assert.Equal(t, tc.content, secret)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.errText)
		})
	}
}

// naming no source at all is the one way a project says it wants no webhook,
// and it is the only case that answers with no secret and no error
func TestResolveHookSecretWithoutASource(t *testing.T) {
	// act
	secret, err := resolveHookSecret("", "")

	// assert
	require.NoError(t, err)
	assert.Empty(t, secret)
}

// an operator who put the variable in a compose file and got nothing into it
// has a broken secret, which the git credential's "present but empty means no
// credential" rule would read as a webhook nobody asked for
func TestFlagProjectsRefuseAnEmptyHookVariable(t *testing.T) {
	// arrange
	t.Setenv(repoHookSecretEnv, "")
	opts := &options{Root: "/notes", Project: "notes"}
	opts.Repo.URL = "https://github.com/acme/wiki.git"
	opts.Repo.Branch = "main"

	// act
	_, err := loadConfig(opts)

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), repoHookSecretEnv+" names no value")
}

func TestFlagProjectsWithoutTheFixedHookVariable(t *testing.T) {
	// arrange
	opts := &options{Root: "/notes", Project: "notes"}
	opts.Repo.URL = "https://github.com/acme/wiki.git"
	opts.Repo.Branch = "main"

	// act
	cfgs, err := loadConfig(opts)

	// assert
	require.NoError(t, err)
	require.NotNil(t, cfgs[0].Remote)
	assert.Empty(t, cfgs[0].Remote.HookSecret, "no variable is no webhook, and no error either")
}

// the yaml path, end to end: the file is named, it holds nothing, and the
// server refuses to start instead of serving a project whose webhook is off
func TestLoadConfigRefusesAnEmptyHookSecretFile(t *testing.T) {
	// arrange
	file := filepath.Join(t.TempDir(), "hook")
	require.NoError(t, os.WriteFile(file, nil, 0o600))

	// act
	_, err := loadConfig(&options{Config: writeConfig(t, `
projects:
  - name: team
    dir: /data/team
    repo:
      url: https://x/y.git
      branch: main
      hook_secret_file: `+file+`
`)})

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), `project "team"`)
	assert.Contains(t, err.Error(), "shorter than 32 bytes")
}

// the reason is the session key's reason: a file inside a project is on the
// tree, in the index, in every backup of the corpus and downloadable through
// /raw/ by anybody who can sign in
func TestCheckSecretFilesCoversTheHookSecrets(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()

	tests := []struct {
		name    string
		file    string
		refused bool
	}{
		{name: "outside every root", file: filepath.Join(t.TempDir(), "hook")},
		{name: "inside its own project root", file: filepath.Join(root, "hook"), refused: true},
		{name: "inside another project's root", file: filepath.Join(other, "hook"), refused: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			opts := &options{}
			opts.Auth.Disabled = true
			cfgs := []projectConfig{{
				Name:   "team",
				Remote: &remoteConfig{HookSecretFile: tc.file},
			}}

			// act
			err := checkSecretFiles([]string{root, other}, opts, cfgs)

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

// TestCheckSecretFilesResolvesBothSides is the matrix the two tests above do
// not cover on their own, and it exists because leaving it out shipped the bug
// twice.
//
// One directory can be named two ways, and a check that follows the symlinks of
// one side only lets the other through. Both sides are varied independently,
// because the mistake appears in both directions, and the file is placed at
// depths that do not exist yet, because EvalSymlinks fails on a path with any
// missing component and resolving just the parent covers one level and no more.
//
// None of this is contrived: on macOS every path under /var is reached through
// a symlink, and auth creates the session key on first start, so "the caller
// spelled it differently and the file is not there yet" is the ordinary case.
func TestCheckSecretFilesResolvesBothSides(t *testing.T) {
	// where the secret sits under the project root, in segments, so a case can
	// name a directory nobody has made
	places := map[string][]string{
		"directly inside":                       {"secret"},
		"one directory down, not created":       {"secrets", "secret"},
		"two directories down, neither created": {"var", "secrets", "secret"},
	}

	for rootAs, spellRoot := range pathSpellings() {
		for fileAs, spellFile := range pathSpellings() {
			for place, under := range places {
				t.Run(rootAs+" root, "+fileAs+" secret, "+place, func(t *testing.T) {
					// arrange
					dir := t.TempDir()
					file := filepath.Join(append([]string{spellFile(t, dir)}, under...)...)
					opts := &options{}
					opts.Auth.SecretFile = file
					cfgs := []projectConfig{{
						Name:   "team",
						Remote: &remoteConfig{HookSecretFile: file},
					}}

					// act & assert: the same file, named two ways, refused both
					// as the session key and as a hook secret
					assert.Error(t, checkSecretFiles([]string{spellRoot(t, dir)}, opts, cfgs))
				})
			}
		}
	}
}

// pathSpellings are the ways a caller happens to name one directory. They reach
// the same place, which is exactly what a path comparison has to agree about.
func pathSpellings() map[string]func(t *testing.T, dir string) string {
	return map[string]func(t *testing.T, dir string) string{
		"a plain": func(_ *testing.T, dir string) string { return dir },
		"a symlinked": func(t *testing.T, dir string) string {
			t.Helper()
			link := filepath.Join(t.TempDir(), "link")
			require.NoError(t, os.Symlink(dir, link))
			return link
		},
	}
}

func TestSecretsOfCarriesTheHookSecret(t *testing.T) {
	// arrange
	cfgs := []projectConfig{{
		Name:   "team",
		Remote: &remoteConfig{Token: "Bearer ghp_xxx", HookSecret: aSecret},
	}}

	// act
	secrets := secretsOf(&options{}, cfgs)

	// assert
	assert.Equal(t, []string{"Bearer ghp_xxx", aSecret}, secrets)
}

// TestSyncLoopCoalesces is why the trigger is a capacity-one channel: twenty
// deliveries ask the same question, and twenty goroutines would each take the
// history lock in turn and put every save behind the whole queue. One pending
// run is still kept, because a delivery that arrived while a Sync was in
// flight has to cause another one.
func TestSyncLoopCoalesces(t *testing.T) {
	// arrange
	rp := testRuntime(t, 0)
	started := make(chan struct{})
	release := make(chan struct{})
	var mu sync.Mutex
	runs := 0

	run := func(context.Context, string, *history.Service) {
		mu.Lock()
		runs++
		first := runs == 1
		mu.Unlock()
		if first {
			close(started)
			<-release
		}
	}

	ctx, cancel := context.WithCancel(t.Context())
	done := syncLoop(ctx, rp, run)

	// act
	rp.notify()
	<-started
	for range 20 {
		rp.notify()
	}
	close(release)

	// assert
	assert.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return runs == 2
	}, 5*time.Second, 10*time.Millisecond, "twenty deliveries during one run collapse into one more")
	cancel()
	<-done
}

func TestSyncLoopWithoutATickerSitsIdle(t *testing.T) {
	// arrange
	rp := testRuntime(t, 0)
	runs := make(chan struct{}, 8)
	ctx, cancel := context.WithCancel(t.Context())
	done := syncLoop(ctx, rp, func(context.Context, string, *history.Service) { runs <- struct{}{} })

	// act
	time.Sleep(50 * time.Millisecond)
	cancel()

	// assert
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the loop outlived its context")
	}
	assert.Empty(t, runs, "pull: 0 and no delivery means nothing fetches")
}

// select picks at random among ready cases, so a trigger queued at shutdown can
// win against a closed ctx.Done(). Sync then takes a plain mutex that knows
// nothing about the context, and the shutdown would wait on a save.
func TestSyncLoopIgnoresATriggerQueuedAtShutdown(t *testing.T) {
	// arrange
	rp := testRuntime(t, 0)
	runs := make(chan struct{}, 8)
	ctx, cancel := context.WithCancel(t.Context())
	rp.notify()
	cancel()

	// act
	done := syncLoop(ctx, rp, func(context.Context, string, *history.Service) { runs <- struct{}{} })

	// assert
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the loop outlived its context")
	}
	assert.Empty(t, runs)
}

func TestSyncLoopRunsOnTheTicker(t *testing.T) {
	// arrange
	rp := testRuntime(t, 10*time.Millisecond)
	runs := make(chan struct{}, 8)
	ctx, cancel := context.WithCancel(t.Context())
	done := syncLoop(ctx, rp, func(context.Context, string, *history.Service) { runs <- struct{}{} })

	// act & assert
	select {
	case <-runs:
	case <-time.After(5 * time.Second):
		t.Fatal("the ticker never fired")
	}
	cancel()
	<-done
}

// TestRunDoesNotHangOnABusyPort is the deadlock the worker context exists to
// avoid: Web.Run returns as soon as ListenAndServe fails while ctx is still
// live, and a wait on a goroutine that only exits with that context would hang
// the process.
func TestRunDoesNotHangOnABusyPort(t *testing.T) {
	// arrange
	listener := mustListen(t)
	opts, err := parseOpts([]string{
		"--root=./examples/data", "--project=notes", "--listen=" + listener,
		"--auth.disabled", "--history=off",
	})
	require.NoError(t, err)

	// act
	failed := make(chan error, 1)
	go func() { failed <- run(t.Context(), opts, projectsFrom(t, opts)) }()

	// assert
	select {
	case runErr := <-failed:
		require.Error(t, runErr)
		assert.Contains(t, runErr.Error(), "run server")
	case <-time.After(10 * time.Second):
		t.Fatal("run hung instead of returning the listen failure")
	}
}

func TestLogRemoteRedactsTheURL(t *testing.T) {
	// act & assert
	assert.Equal(t, "https://x/y.git", redactURL("https://x/y.git"))
	assert.Equal(t, "https://***@x/y.git", redactURL("https://bob:pass@x/y.git"))
	assert.Equal(t, "git@github.com:acme/wiki.git", redactURL("git@github.com:acme/wiki.git"))
}

// testRuntime is the smallest project a sync loop needs: a name, a trigger and
// an interval. There is no repository behind it, because the loop's job is
// deciding when to run and never what running means.
func testRuntime(t *testing.T, pull time.Duration) *runtimeProject {
	t.Helper()
	return &runtimeProject{
		web:     &server.Project{Name: "wiki"},
		pull:    pull,
		trigger: make(chan struct{}, 1),
	}
}

// mustListen holds a port so a second server cannot have it.
func mustListen(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = ln.Close() })
	return ln.Addr().String()
}
