package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// bareOrigin makes a remote nothing has to reach the network for: a bare
// repository with one commit on main.
func bareOrigin(t *testing.T) string {
	t.Helper()
	requireGit(t)

	bare := filepath.Join(t.TempDir(), "origin.git")
	require.NoError(t, os.MkdirAll(bare, 0o755))
	runGitIn(t, bare, "init", "--quiet", "--bare", "--initial-branch=main", ".")

	seed := t.TempDir()
	runGitIn(t, seed, "init", "--quiet", "--initial-branch=main", ".")
	require.NoError(t, os.WriteFile(filepath.Join(seed, "index.md"), []byte("# Seed\n"), 0o600))
	runGitIn(t, seed, "add", "index.md")
	runGitIn(t, seed, "-c", "user.name=seed", "-c", "user.email=s@x", "commit", "--quiet", "-m", "seed")
	runGitIn(t, seed, "remote", "add", "origin", bare)
	runGitIn(t, seed, "push", "--quiet", "origin", "main")
	return bare
}

func runGitIn(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.CommandContext(t.Context(), "git",
		append([]string{"--no-pager", "-c", "safe.directory=" + dir}, args...)...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null", "LC_ALL=C")
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "git %v: %s", args, out)
	return string(out)
}

func TestEnsureDirsClonesOnlyWhatIsEmpty(t *testing.T) {
	// arrange
	bare := bareOrigin(t)
	fresh := filepath.Join(t.TempDir(), "fresh")
	local := t.TempDir()
	cfgs := []projectConfig{
		{Name: "wiki", Dir: fresh, Remote: &remoteConfig{URL: bare, Branch: "main"}},
		{Name: "notes", Dir: local},
	}

	// act
	err := ensureDirs(t.Context(), &options{}, cfgs)

	// assert
	require.NoError(t, err)
	assert.FileExists(t, filepath.Join(fresh, "index.md"))
	assert.NoDirExists(t, filepath.Join(local, ".git"), "a local project's directory is never touched")
}

func TestEnsureDirsLeavesAnExistingCloneAlone(t *testing.T) {
	// arrange
	bare := bareOrigin(t)
	dir := filepath.Join(t.TempDir(), "clone")
	cfgs := []projectConfig{{Name: "wiki", Dir: dir, Remote: &remoteConfig{URL: bare, Branch: "main"}}}
	require.NoError(t, ensureDirs(t.Context(), &options{}, cfgs))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "unpushed.md"), []byte("# Mine\n"), 0o600))

	// act
	err := ensureDirs(t.Context(), &options{}, cfgs)

	// assert
	require.NoError(t, err)
	assert.FileExists(t, filepath.Join(dir, "unpushed.md"),
		"a second clone would throw away commits that were never pushed")
}

// TestNewHistoryForcesItselfOnForARemote is the one place --history does not
// decide: a project that silently stopped recording would also silently stop
// pushing.
func TestNewHistoryForcesItselfOnForARemote(t *testing.T) {
	// arrange
	bare := bareOrigin(t)
	dir := filepath.Join(t.TempDir(), "clone")
	cfg := projectConfig{Name: "wiki", Dir: dir, Remote: &remoteConfig{URL: bare, Branch: "main"}}
	require.NoError(t, ensureDirs(t.Context(), &options{}, []projectConfig{cfg}))

	// act
	hist, err := newHistory(&options{History: historyOff}, cfg, notesAt(t, dir))

	// assert
	require.NoError(t, err)
	t.Cleanup(func() { assert.NoError(t, hist.Close()) })
	assert.True(t, hist.Enabled())
	assert.True(t, hist.Remote())
}

func TestNewHistoryRefusesAClonePointedElsewhere(t *testing.T) {
	// arrange
	bare := bareOrigin(t)
	dir := filepath.Join(t.TempDir(), "clone")
	cfg := projectConfig{Name: "wiki", Dir: dir, Remote: &remoteConfig{URL: bare, Branch: "main"}}
	require.NoError(t, ensureDirs(t.Context(), &options{}, []projectConfig{cfg}))
	cfg.Remote.Branch = "other"

	// act
	_, err := newHistory(&options{History: historyAuto}, cfg, notesAt(t, dir))

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not the configured other")
}

func TestRemoteOfCarriesTheEffectiveReadOnlyMode(t *testing.T) {
	tests := []struct {
		name     string
		global   bool
		project  bool
		pullOnly bool
	}{
		{name: "writable"},
		{name: "the whole server is read-only", global: true, pullOnly: true},
		{name: "this project is read-only", project: true, pullOnly: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			cfg := projectConfig{
				Name: "wiki", ReadOnly: tc.project,
				Remote: &remoteConfig{URL: "https://x/y.git", Branch: "main", Pull: time.Minute},
			}

			// act
			rm := remoteOf(&options{ReadOnly: tc.global}, cfg)

			// assert
			assert.Equal(t, tc.pullOnly, rm.PullOnly)
			assert.Equal(t, time.Minute, rm.PullEvery)
		})
	}
}

func TestPullEvery(t *testing.T) {
	// act & assert
	assert.Zero(t, pullEvery(projectConfig{}))
	assert.Equal(t, time.Minute, pullEvery(projectConfig{Remote: &remoteConfig{Pull: time.Minute}}))
}

// TestARemoteProjectPushesWhatTheAppSaves is the whole feature seen from the
// outside: a project whose directory is a clone records a save and the origin
// has it.
func TestARemoteProjectPushesWhatTheAppSaves(t *testing.T) {
	// arrange
	bare := bareOrigin(t)
	dir := filepath.Join(t.TempDir(), "clone")
	cfg := projectConfig{Name: "wiki", Dir: dir, Remote: &remoteConfig{URL: bare, Branch: "main"}}
	require.NoError(t, ensureDirs(t.Context(), &options{}, []projectConfig{cfg}))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "added.md"), []byte("# Added\n"), 0o600))

	notes := notesAt(t, dir)
	hist, err := newHistory(&options{History: historyAuto}, cfg, notes)
	require.NoError(t, err)
	t.Cleanup(func() { assert.NoError(t, hist.Close()) })

	// act
	reconcile(t.Context(), cfg.Name, hist, historyActorStartup)
	syncRemote(t.Context(), cfg.Name, hist)

	// assert
	assert.Contains(t, runGitIn(t, bare, "ls-tree", "--name-only", "main"), "added.md")
	assert.False(t, hist.Unpublished())
	assert.Empty(t, hist.SyncError())
}

// TestAReadOnlyRemoteProjectRecordsNothing is the wiring of the pull-only rule,
// through the helper both the startup and the watcher go through: a file that
// appears on disk is served and never committed, so the project does not report
// itself unpublished for a change no reader made.
func TestAReadOnlyRemoteProjectRecordsNothing(t *testing.T) {
	// arrange
	bare := bareOrigin(t)
	dir := filepath.Join(t.TempDir(), "clone")
	cfg := projectConfig{Name: "wiki", Dir: dir, ReadOnly: true, Remote: &remoteConfig{URL: bare, Branch: "main"}}
	opts := &options{History: historyAuto}
	require.NoError(t, ensureDirs(t.Context(), opts, []projectConfig{cfg}))

	hist, err := newHistory(opts, cfg, notesAt(t, dir))
	require.NoError(t, err)
	t.Cleanup(func() { assert.NoError(t, hist.Close()) })
	before := runGitIn(t, dir, "rev-parse", "HEAD")
	require.NoError(t, os.WriteFile(filepath.Join(dir, "over-smb.md"), []byte("# Somebody else\n"), 0o600))

	// act
	reconcile(t.Context(), cfg.Name, hist, historyActorExternal)
	syncRemote(t.Context(), cfg.Name, hist)

	// assert
	assert.Equal(t, before, runGitIn(t, dir, "rev-parse", "HEAD"), "nothing was committed")
	assert.NotContains(t, runGitIn(t, bare, "ls-tree", "--name-only", "main"), "over-smb.md")
	assert.False(t, hist.Unpublished())
	assert.Empty(t, hist.SyncError())
}

// TestARemoteProjectTracksEveryVisibleFile is why TrackAll exists: the editor
// opens far more types than local history keeps, and on a clone that gap is a
// change that never leaves the container.
func TestARemoteProjectTracksEveryVisibleFile(t *testing.T) {
	// arrange
	bare := bareOrigin(t)
	dir := filepath.Join(t.TempDir(), "clone")
	cfg := projectConfig{Name: "wiki", Dir: dir, Remote: &remoteConfig{URL: bare, Branch: "main"}}
	require.NoError(t, ensureDirs(t.Context(), &options{}, []projectConfig{cfg}))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "config.toml"), []byte("key = 1\n"), 0o600))

	hist, err := newHistory(&options{History: historyAuto}, cfg, notesAt(t, dir))
	require.NoError(t, err)
	t.Cleanup(func() { assert.NoError(t, hist.Close()) })

	// act
	reconcile(t.Context(), cfg.Name, hist, historyActorStartup)

	// assert
	assert.Contains(t, strings.Split(runGitIn(t, bare, "ls-tree", "--name-only", "main"), "\n"), "config.toml")
}
