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

const aSecret = "0123456789abcdef0123456789abcdef"

func TestLoadConfigReadsTheHookSecret(t *testing.T) {
	// arrange
	t.Setenv("SCRAWL_TEST_HOOK", aSecret)
	opts := &options{SpacesFile: writeConfig(t, `
spaces:
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

func TestFlagSpacesReadTheFixedHookVariable(t *testing.T) {
	// arrange
	t.Setenv(repoHookSecretEnv, aSecret)
	opts := &options{Space: spaceOptions{Name: "notes", Dir: "/notes"}}
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
	_, err := loadConfig(&options{SpacesFile: writeConfig(t, `
spaces:
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

func TestResolveHookSecretWithoutASource(t *testing.T) {
	// act
	secret, err := resolveHookSecret("", "")

	// assert
	require.NoError(t, err)
	assert.Empty(t, secret)
}

func TestFlagSpacesRefuseAnEmptyHookVariable(t *testing.T) {
	// arrange
	t.Setenv(repoHookSecretEnv, "")
	opts := &options{Space: spaceOptions{Name: "notes", Dir: "/notes"}}
	opts.Repo.URL = "https://github.com/acme/wiki.git"
	opts.Repo.Branch = "main"

	// act
	_, err := loadConfig(opts)

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), repoHookSecretEnv+" names no value")
}

func TestFlagSpacesWithoutTheFixedHookVariable(t *testing.T) {
	// arrange
	opts := &options{Space: spaceOptions{Name: "notes", Dir: "/notes"}}
	opts.Repo.URL = "https://github.com/acme/wiki.git"
	opts.Repo.Branch = "main"

	// act
	cfgs, err := loadConfig(opts)

	// assert
	require.NoError(t, err)
	require.NotNil(t, cfgs[0].Remote)
	assert.Empty(t, cfgs[0].Remote.HookSecret, "no variable is no webhook, and no error either")
}

func TestLoadConfigRefusesAnEmptyHookSecretFile(t *testing.T) {
	// arrange
	file := filepath.Join(t.TempDir(), "hook")
	require.NoError(t, os.WriteFile(file, nil, 0o600))

	// act
	_, err := loadConfig(&options{SpacesFile: writeConfig(t, `
spaces:
  - name: team
    dir: /data/team
    repo:
      url: https://x/y.git
      branch: main
      hook_secret_file: `+file+`
`)})

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), `space "team"`)
	assert.Contains(t, err.Error(), "shorter than 32 bytes")
}

func TestCheckSecretFilesCoversTheHookSecrets(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()

	tests := []struct {
		name    string
		file    string
		refused bool
	}{
		{name: "outside every root", file: filepath.Join(t.TempDir(), "hook")},
		{name: "inside its own space root", file: filepath.Join(root, "hook"), refused: true},
		{name: "inside another space's root", file: filepath.Join(other, "hook"), refused: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			opts := &options{}
			opts.Auth.Disabled = true
			cfgs := []spaceConfig{{
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

func TestCheckSecretFilesResolvesBothSides(t *testing.T) {
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
					cfgs := []spaceConfig{{
						Name:   "team",
						Remote: &remoteConfig{HookSecretFile: file},
					}}

					assert.Error(t, checkSecretFiles([]string{spellRoot(t, dir)}, opts, cfgs))
				})
			}
		}
	}
}

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
	cfgs := []spaceConfig{{
		Name:   "team",
		Remote: &remoteConfig{Token: "Bearer ghp_xxx", HookSecret: aSecret},
	}}

	// act
	secrets := secretsOf(&options{}, cfgs)

	// assert
	assert.Equal(t, []string{"Bearer ghp_xxx", aSecret}, secrets)
}

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

func TestRunDoesNotHangOnABusyPort(t *testing.T) {
	// arrange
	listener := mustListen(t)
	opts, err := parseOpts([]string{
		"--space.dir=./examples/data", "--space.name=notes", "--listen=" + listener,
		"--auth.disabled", "--history=off",
	})
	require.NoError(t, err)

	// act
	failed := make(chan error, 1)
	go func() { failed <- run(t.Context(), opts, spacesFrom(t, opts)) }()

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

func testRuntime(t *testing.T, pull time.Duration) *runtimeSpace {
	t.Helper()
	return &runtimeSpace{
		web:     &server.Space{Name: "wiki"},
		pull:    pull,
		trigger: make(chan struct{}, 1),
	}
}

func mustListen(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = ln.Close() })
	return ln.Addr().String()
}
