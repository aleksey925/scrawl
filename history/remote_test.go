package history

import (
	"context"
	"fmt"
	"net/http"
	"net/http/cgi"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func bareRemote(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}

	bare := filepath.Join(t.TempDir(), "origin.git")
	require.NoError(t, os.MkdirAll(bare, 0o755))
	gitIn(t, bare, "init", "--quiet", "--bare", "--initial-branch="+initialBranch, ".")

	seed := t.TempDir()
	gitInit(t, seed)
	writeFile(t, seed, "index.md", "# Seed\n")
	gitIn(t, seed, "add", "index.md")
	gitIn(t, seed, "-c", "user.name=seed", "-c", "user.email=seed@x", "commit", "--quiet", "-m", "seed")
	gitIn(t, seed, "remote", "add", remoteName, bare)
	gitIn(t, seed, "push", "--quiet", remoteName, initialBranch)
	return bare
}

func cloneOf(t *testing.T, bare string) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "notes")
	require.NoError(t, Clone(t.Context(), dir, Remote{URL: bare, Branch: initialBranch}))
	return dir
}

func remoteService(t *testing.T, dir, bare string, tune ...func(*Remote)) *Service {
	t.Helper()
	rm := &Remote{URL: bare, Branch: initialBranch}
	for _, fn := range tune {
		fn(rm)
	}
	return serviceAt(t, dir, func(cfg *Config) {
		cfg.Remote = rm
		cfg.TrackAll = true
	})
}

func headOf(t *testing.T, bare string) string {
	t.Helper()
	return strings.TrimSpace(gitIn(t, bare, "rev-parse", initialBranch))
}

func localHead(t *testing.T, dir string) string {
	t.Helper()
	return strings.TrimSpace(gitIn(t, dir, "rev-parse", "HEAD"))
}

func TestCloneLandsCompleteOrNotAtAll(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := filepath.Join(t.TempDir(), "notes")

	// act
	require.NoError(t, Clone(t.Context(), dir, Remote{URL: bare, Branch: initialBranch}))

	// assert
	assert.FileExists(t, filepath.Join(dir, "index.md"))
	assert.DirExists(t, filepath.Join(dir, ".git"))
	assert.NoDirExists(t, filepath.Join(dir, StagingDir), "the staging directory is gone either way")
}

func TestCloneRefusesAMissingBranch(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := filepath.Join(t.TempDir(), "notes")

	// act
	err := Clone(t.Context(), dir, Remote{URL: bare, Branch: "nope"})

	// assert
	require.Error(t, err)
	assert.Empty(t, dirNames(t, dir), "nothing is left to make the next start refuse")
}

func TestCloneNeedsNothingOfTheParent(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores the permissions this test is about")
	}
	// arrange
	bare := bareRemote(t)
	parent := filepath.Join(t.TempDir(), "image")
	dir := filepath.Join(parent, "notes")
	require.NoError(t, os.MkdirAll(dir, 0o750))
	require.NoError(t, os.Chmod(parent, 0o555))
	t.Cleanup(func() { _ = os.Chmod(parent, 0o750) })

	// act
	err := Clone(t.Context(), dir, Remote{URL: bare, Branch: initialBranch})

	// assert
	require.NoError(t, err)
	assert.FileExists(t, filepath.Join(dir, "index.md"))
}

func TestCloneClearsAnInterruptedOne(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := filepath.Join(t.TempDir(), "notes")
	require.NoError(t, os.MkdirAll(filepath.Join(dir, StagingDir, "work"), 0o750))
	writeFile(t, dir, "half-moved.md", "# Half moved\n")

	// act
	require.NoError(t, Clone(t.Context(), dir, Remote{URL: bare, Branch: initialBranch}))

	// assert
	assert.Equal(t, []string{".git", "index.md"}, dirNames(t, dir))
}

func dirNames(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	res := make([]string, 0, len(entries))
	for _, ent := range entries {
		res = append(res, ent.Name())
	}
	return res
}

func TestNewRefusesAClonePointedElsewhere(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)

	tests := []struct {
		name    string
		remote  Remote
		errText string
	}{
		{name: "the configured url", remote: Remote{URL: bare, Branch: initialBranch}},
		{
			name:    "another url",
			remote:  Remote{URL: bareRemote(t), Branch: initialBranch},
			errText: "not the configured",
		},
		{
			name:    "another branch",
			remote:  Remote{URL: bare, Branch: "other"},
			errText: "not the configured other",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			svc, err := New(Config{
				Root:   dir,
				Files:  func() ([]string, error) { return visibleFiles(dir) },
				Remote: &tc.remote,
			})

			// assert
			if tc.errText != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.errText)
				return
			}
			require.NoError(t, err)
			assert.NoError(t, svc.Close())
		})
	}
}

func TestSyncFastForwardsAndPushes(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	writeFile(t, dir, "local.md", "# Local\n")

	// act
	require.NoError(t, svc.Reconcile(t.Context(), "alex"))
	require.NoError(t, svc.Sync(t.Context()))

	// assert
	assert.False(t, svc.Unpublished(), "the sync pushed what the reconcile committed")
	assert.Empty(t, svc.SyncError())
	assert.Contains(t, gitIn(t, bare, "ls-tree", "--name-only", initialBranch), "local.md")
}

func TestSyncMergesWhatTheRemoteGained(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	pushFromElsewhere(t, bare, "upstream.md", "# Upstream\n")

	// act
	require.NoError(t, svc.Sync(t.Context()))

	// assert
	assert.FileExists(t, filepath.Join(dir, "upstream.md"))
	assert.False(t, svc.Unpublished())
	assert.Empty(t, svc.SyncError())
}

func TestAFailedPushSurvivesASaveThatStagesNothing(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	writeFile(t, dir, "local.md", "# Local\n")
	require.NoError(t, svc.Reconcile(t.Context(), "alex"))
	require.NoError(t, svc.Sync(t.Context()))

	// act
	writeFile(t, dir, "second.md", "# Second\n")
	breakRemote(t, dir)
	require.NoError(t, svc.Reconcile(t.Context(), "alex"))
	require.Error(t, svc.pushNow(t.Context()))
	unpublishedAfterPush := svc.Unpublished()
	require.NoError(t, svc.Record(t.Context(), Op{Message: "touch", Paths: []string{"second.md"}},
		func() ([]string, error) { return nil, nil }))

	// assert
	assert.True(t, unpublishedAfterPush)
	assert.False(t, svc.Degraded(), "the commit landed, so the commit state is healthy")
	assert.True(t, svc.Unpublished(), "the remote is still behind")
	assert.Contains(t, svc.SyncError(), "push:")
}

func TestUnpublishedIsMeasuredNotRemembered(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	first := remoteService(t, dir, bare)
	writeFile(t, dir, "local.md", "# Local\n")
	breakRemote(t, dir)
	require.NoError(t, first.Reconcile(t.Context(), "alex"))
	require.NoError(t, first.Close())
	fixRemote(t, dir, bare)

	// act
	restarted := remoteService(t, dir, bare)
	beforeSync := restarted.Unpublished()
	require.NoError(t, restarted.Sync(t.Context()))

	// assert
	assert.False(t, beforeSync, "nothing has measured yet, so the flag is only what a sync answers")
	assert.False(t, restarted.Unpublished(), "the sync pushed what the previous run could not")
	assert.Contains(t, gitIn(t, bare, "ls-tree", "--name-only", initialBranch), "local.md")
}

func TestADivergedBranchIsLoudAndNeverPushed(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	writeFile(t, dir, "mine.md", "# Mine\n")
	breakRemote(t, dir)
	require.NoError(t, svc.Reconcile(t.Context(), "alex"))
	fixRemote(t, dir, bare)
	pushFromElsewhere(t, bare, "theirs.md", "# Theirs\n")
	before := headOf(t, bare)

	// act
	err := svc.Sync(t.Context())

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "merge")
	assert.True(t, svc.Unpublished())
	assert.Contains(t, svc.SyncError(), "diverged")
	assert.True(t, svc.SyncState().Diverged)
	assert.Equal(t, before, headOf(t, bare), "nothing was pushed over the divergence")
}

func TestAnIgnoredButVisibleFileStillReachesTheRemote(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	writeFile(t, dir, ".gitignore", "*.toml\n")
	writeFile(t, dir, "config.toml", "key = 1\n")
	svc := remoteService(t, dir, bare)

	// act
	require.NoError(t, svc.Record(t.Context(), Op{Message: "save config.toml", Paths: []string{"config.toml"}},
		func() ([]string, error) { return nil, nil }))
	require.NoError(t, svc.pushNow(t.Context()))

	// assert
	assert.Contains(t, gitIn(t, bare, "ls-tree", "--name-only", initialBranch), "config.toml")
	assert.False(t, svc.Unpublished())
}

func TestPullOnlyNeverWritesToGit(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare, func(rm *Remote) { rm.PullOnly = true })
	pushFromElsewhere(t, bare, "upstream.md", "# Upstream\n")
	before := headOf(t, bare)
	writeFile(t, dir, "local.md", "# Local\n")

	// act
	require.NoError(t, svc.Sync(t.Context()))

	// assert
	assert.FileExists(t, filepath.Join(dir, "upstream.md"), "a fast forward still lands")
	assert.Empty(t, svc.SyncError(), "a pull-only run clears after the merge, with no push to wait for")
	assert.Equal(t, before, headOf(t, bare), "nothing was pushed")
	assert.NotContains(t, gitIn(t, bare, "ls-tree", "--name-only", initialBranch), "local.md")
}

func TestPullOnlyNeverReconciles(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare, func(rm *Remote) { rm.PullOnly = true })
	before := localHead(t, dir)
	writeFile(t, dir, "over-smb.md", "# Somebody else\n")

	// act
	require.NoError(t, svc.Reconcile(t.Context(), "external"))
	require.NoError(t, svc.Sync(t.Context()))

	// assert
	assert.Equal(t, before, localHead(t, dir), "nothing was committed")
	assert.NotContains(t, gitIn(t, dir, "ls-files"), "over-smb.md")
	assert.False(t, svc.Unpublished(), "a clone that commits nothing is never ahead of its origin")
	assert.Empty(t, svc.SyncError())
}

func TestProbeWritable(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)

	// act
	ok := svc.ProbeWritable(t.Context())
	breakRemote(t, dir)
	refused := svc.ProbeWritable(t.Context())

	// assert
	assert.NoError(t, ok)
	assert.Error(t, refused)
}

func TestALocalServiceHasNoPublicationState(t *testing.T) {
	// arrange
	svc := newService(t)

	// act & assert
	assert.False(t, svc.Remote())
	assert.False(t, svc.Unpublished())
	assert.Empty(t, svc.SyncError())
	assert.NoError(t, svc.Sync(t.Context()))
	assert.NoError(t, svc.ProbeWritable(t.Context()))
}

func TestANilServiceAnswersThePublicationState(t *testing.T) {
	// arrange
	var svc *Service

	// act & assert
	assert.False(t, svc.Remote())
	assert.False(t, svc.Unpublished())
	assert.Empty(t, svc.SyncError())
	assert.NoError(t, svc.Sync(t.Context()))
	assert.NoError(t, svc.ProbeWritable(t.Context()))
}

func TestUnsyncedListsWhatTheRemoteIsMissing(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	writeFile(t, dir, "mine.md", "# Mine\n")
	writeFile(t, dir, "notes/other.md", "# Other\n")
	breakRemote(t, dir)

	// act
	require.NoError(t, svc.Reconcile(t.Context(), "alex"))
	require.Error(t, svc.pushNow(t.Context()))
	broken := svc.SyncState()
	fixRemote(t, dir, bare)
	require.NoError(t, svc.Sync(t.Context()))
	healed := svc.SyncState()

	// assert
	assert.True(t, broken.Unpublished)
	assert.Equal(t, []string{"mine.md", "notes/other.md"}, broken.Unsynced.Paths)
	assert.False(t, broken.Unsynced.Many)
	assert.Contains(t, broken.Error, "push:")

	assert.Equal(t, SyncState{}, healed, "a push that landed leaves nothing behind")
}

func TestAPushTheRemoteWillNotAuthorizeIsRefused(t *testing.T) {
	tests := []struct {
		name     string
		origin   func(t *testing.T) string
		expected bool
	}{
		{name: "the remote asks for a credential", origin: originAnswering(http.StatusUnauthorized), expected: true},
		{name: "the credential may not write", origin: originAnswering(http.StatusForbidden), expected: true},
		{name: "the remote is not there", origin: func(t *testing.T) string {
			return filepath.Join(t.TempDir(), "gone.git")
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			bare := bareRemote(t)
			dir := cloneOf(t, bare)
			svc := remoteService(t, dir, bare)
			writeFile(t, dir, "mine.md", "# Mine\n")
			gitIn(t, dir, "remote", "set-url", remoteName, tc.origin(t))

			// act
			require.NoError(t, svc.Reconcile(t.Context(), "alex"))
			require.Error(t, svc.pushNow(t.Context()))
			state := svc.SyncState()

			// assert
			assert.Contains(t, state.Error, "push:")
			assert.Equal(t, tc.expected, state.Refused, state.Error)
		})
	}
}

func TestUnsyncedNamesOnlyThisSide(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	writeFile(t, dir, "mine.md", "# Mine\n")
	breakRemote(t, dir)
	require.NoError(t, svc.Reconcile(t.Context(), "alex"))
	fixRemote(t, dir, bare)
	pushFromElsewhere(t, bare, "theirs.md", "# Theirs\n")

	// act
	require.Error(t, svc.Sync(t.Context()))
	state := svc.SyncState()

	// assert
	assert.Equal(t, []string{"mine.md"}, state.Unsynced.Paths)
	assert.Contains(t, state.Error, "merge:")
}

func TestUnsyncedFiltersBeforeItCaps(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := serviceAt(t, dir, func(cfg *Config) {
		cfg.Remote = &Remote{URL: bare, Branch: initialBranch}
		cfg.TrackAll = true
		cfg.Visible = func(p string) bool { return !strings.HasPrefix(p, "hidden/") }
	})
	for i := range unsyncedCap + 1 {
		writeFile(t, dir, fmt.Sprintf("hidden/%03d.md", i), "# Hidden\n")
	}
	writeFile(t, dir, "seen.md", "# Seen\n")
	breakRemote(t, dir)

	// act
	require.NoError(t, svc.Reconcile(t.Context(), "alex"))
	require.Error(t, svc.pushNow(t.Context()))

	// assert
	state := svc.SyncState()
	assert.Equal(t, []string{"seen.md"}, state.Unsynced.Paths,
		"a hidden path is never a second way into the notes, and never spends the cap")
	assert.False(t, state.Unsynced.Many)
}

func TestUnsyncedDropsTheListAboveTheCap(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	for i := range unsyncedCap + 1 {
		writeFile(t, dir, fmt.Sprintf("note-%03d.md", i), "# Note\n")
	}
	breakRemote(t, dir)

	// act
	require.NoError(t, svc.Reconcile(t.Context(), "alex"))
	require.Error(t, svc.pushNow(t.Context()))

	// assert
	state := svc.SyncState()
	assert.True(t, state.Unsynced.Many)
	assert.Empty(t, state.Unsynced.Paths)
	assert.True(t, state.Unpublished)
}

func TestACleanSpaceMeasuresNoPaths(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)

	// act
	require.NoError(t, svc.Sync(t.Context()))

	// assert
	assert.Equal(t, SyncState{}, svc.SyncState())
}

func TestSyncStateIsOneLoad(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	writeFile(t, dir, "mine.md", "# Mine\n")
	breakRemote(t, dir)
	require.NoError(t, svc.Reconcile(t.Context(), "alex"))
	require.Error(t, svc.pushNow(t.Context()))

	// act
	state := svc.SyncState()

	// assert
	assert.Equal(t, state.Unpublished, svc.Unpublished())
	assert.Equal(t, state.Error, svc.SyncError())
	assert.Equal(t, []string{"mine.md"}, state.Unsynced.Paths)
}

func TestANilServiceHasNoSyncState(t *testing.T) {
	// arrange
	var svc *Service

	// act & assert
	assert.Equal(t, SyncState{}, svc.SyncState())
}

func TestRedactURL(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "no credentials", raw: "https://github.com/acme/wiki.git", want: "https://github.com/acme/wiki.git"},
		{name: "a password", raw: "https://bob:pass@github.com/acme/wiki.git", want: "https://***@github.com/acme/wiki.git"},
		{name: "ssh scp form", raw: "git@github.com:acme/wiki.git", want: "git@github.com:acme/wiki.git"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act & assert
			assert.Equal(t, tc.want, redactURL(tc.raw))
		})
	}
}

func TestGitErrorRedactsTheCredential(t *testing.T) {
	// arrange
	err := &gitError{
		args:   []string{"push", "https://bob:pass@example.com/x.git"},
		stderr: "fatal: Authorization: Bearer ghp_secret was refused",
		err:    os.ErrPermission,
		secret: "Bearer ghp_secret",
	}

	// act
	message := err.Error()

	// assert
	assert.NotContains(t, message, "ghp_secret")
	assert.NotContains(t, message, "bob:pass")
	assert.Contains(t, message, redacted)
}

func TestTheTokenReachesOnlyTheNetworkCommands(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare, func(rm *Remote) { rm.Token = "Bearer ghp_secret" })

	// act
	local := strings.Join(svc.env(false), "\n")
	network := strings.Join(svc.env(true), "\n")

	// assert
	assert.NotContains(t, local, "ghp_secret")
	assert.Contains(t, network, "GIT_CONFIG_VALUE_0=Authorization: Bearer ghp_secret")
	assert.Contains(t, network, "GIT_CONFIG_COUNT=1")
}

func pushFromElsewhere(t *testing.T, bare, name, content string) {
	t.Helper()
	other := filepath.Join(t.TempDir(), "other")
	require.NoError(t, Clone(t.Context(), other, Remote{URL: bare, Branch: initialBranch}))
	writeFile(t, other, name, content)
	gitIn(t, other, "add", name)
	gitIn(t, other, "-c", "user.name=other", "-c", "user.email=other@x", "commit", "--quiet", "-m", "from elsewhere")
	gitIn(t, other, "push", "--quiet", remoteName, initialBranch)
}

func breakRemote(t *testing.T, dir string) {
	t.Helper()
	gitIn(t, dir, "remote", "set-url", remoteName, filepath.Join(t.TempDir(), "gone.git"))
}

func fixRemote(t *testing.T, dir, bare string) {
	t.Helper()
	gitIn(t, dir, "remote", "set-url", remoteName, bare)
}

func originAnswering(status int) func(t *testing.T) string {
	return func(t *testing.T) string {
		t.Helper()
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			if status == http.StatusUnauthorized {
				w.Header().Set("WWW-Authenticate", `Basic realm="git"`)
			}
			w.WriteHeader(status)
		}))
		t.Cleanup(srv.Close)
		return srv.URL + "/notes.git"
	}
}

func TestABrowserWriteIsPushedByTheLoopAfterTheRecordReturns(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	before := headOf(t, bare)
	svc.pushDelay = 10 * time.Millisecond
	writeFile(t, dir, "local.md", "# Local\n")

	// act
	require.NoError(t, svc.Record(t.Context(), Op{Message: "save", Paths: []string{"local.md"}},
		func() ([]string, error) { return nil, nil }))
	headAfterRecord := headOf(t, bare)
	queued := len(svc.pushes)
	pushingAfterRecord := svc.SyncState().Pushing
	stop := runPushLoop(t, svc)

	// assert
	assert.Equal(t, before, headAfterRecord, "the record committed and left the push to the loop")
	assert.Equal(t, 1, queued)
	assert.True(t, pushingAfterRecord)
	require.Eventually(t, func() bool { return !svc.SyncState().Pushing }, 10*time.Second, 20*time.Millisecond)
	stop()
	assert.False(t, svc.Unpublished())
	assert.Equal(t, localHead(t, dir), headOf(t, bare))
}

func TestABurstOfBrowserWritesQueuesOnePush(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)

	// act
	for _, name := range []string{"a.md", "b.md", "c.md"} {
		writeFile(t, dir, name, "# "+name+"\n")
		require.NoError(t, svc.Record(t.Context(), Op{Message: "save " + name, Paths: []string{name}},
			func() ([]string, error) { return nil, nil }))
	}

	// assert
	assert.Len(t, svc.pushes, 1)
}

func TestATokenWritePushesInsideTheRecordAndLeavesTheMark(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	writeFile(t, dir, "local.md", "# Local\n")

	// act
	err := svc.Record(t.Context(), Op{Message: "save", Paths: []string{"local.md"}, Strict: true},
		func() ([]string, error) { return nil, nil })

	// assert
	require.NoError(t, err)
	assert.Equal(t, localHead(t, dir), headOf(t, bare))
	assert.Len(t, svc.pushes, 1)
	assert.True(t, svc.SyncState().Pushing)
}

func TestThePushLoopDoesNothingForAPullOnlySpace(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare, func(rm *Remote) { rm.PullOnly = true })

	// act
	returned := make(chan struct{})
	go func() {
		defer close(returned)
		svc.PushLoop(t.Context())
	}()

	// assert
	select {
	case <-returned:
	case <-time.After(5 * time.Second):
		require.FailNow(t, "the loop kept running")
	}
}

func runPushLoop(t *testing.T, svc *Service) func() {
	t.Helper()
	ctx, cancel := context.WithCancel(t.Context())
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		svc.PushLoop(ctx)
	}()
	return func() {
		cancel()
		<-stopped
	}
}

func waitForSync(t *testing.T, svc *Service) {
	t.Helper()
	require.Eventually(t, func() bool { return svc.SyncError() == "" }, 10*time.Second, 20*time.Millisecond)
}

func waitForHit(t *testing.T, hit <-chan struct{}) {
	t.Helper()
	select {
	case <-hit:
	case <-time.After(10 * time.Second):
		require.FailNow(t, "the remote was never asked")
	}
}

func failedPush(t *testing.T, dir string, svc *Service) {
	t.Helper()
	writeFile(t, dir, "mine.md", "# Mine\n")
	breakRemote(t, dir)
	require.NoError(t, svc.Reconcile(t.Context(), "alex"))
	<-svc.pushes
	require.Error(t, svc.pushNow(t.Context()))
	require.True(t, svc.SyncState().Retrying)
}

type gate struct {
	hit     chan struct{}
	release chan struct{}
	once    sync.Once
}

func newGate() *gate {
	return &gate{hit: make(chan struct{}, 1), release: make(chan struct{})}
}

func (g *gate) hold(r *http.Request) bool {
	select {
	case g.hit <- struct{}{}:
	default:
	}
	select {
	case <-g.release:
		return true
	case <-r.Context().Done():
		return false
	}
}

func (g *gate) open() { g.once.Do(func() { close(g.release) }) }

func stalledOrigin(t *testing.T) (string, <-chan struct{}, func()) {
	t.Helper()
	g := newGate()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		g.hold(r)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)
	t.Cleanup(g.open)
	return srv.URL + "/notes.git", g.hit, g.open
}

func gatedOrigin(t *testing.T, bare, service string) (string, <-chan struct{}, func()) {
	t.Helper()
	backend := filepath.Join(strings.TrimSpace(gitIn(t, bare, "--exec-path")), "git-http-backend")
	if _, err := os.Stat(backend); err != nil {
		t.Skip("git-http-backend is not installed")
	}
	cgiBackend := &cgi.Handler{
		Path: backend,
		Env:  []string{"GIT_PROJECT_ROOT=" + filepath.Dir(bare), "GIT_HTTP_EXPORT_ALL=1", "REMOTE_USER=scrawl"},
	}
	g := newGate()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/"+service) && !g.hold(r) {
			return
		}
		cgiBackend.ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close)
	t.Cleanup(g.open)
	return srv.URL + "/" + filepath.Base(bare), g.hit, g.open
}

func saveAsync(ctx context.Context, svc *Service, name string, strict bool) <-chan error {
	done := make(chan error, 1)
	go func() {
		done <- svc.Record(ctx, Op{Message: "save " + name, Paths: []string{name}, Strict: strict},
			func() ([]string, error) { return nil, nil })
	}()
	return done
}

func within[T any](t *testing.T, limit time.Duration, ch <-chan T) T {
	t.Helper()
	select {
	case res := <-ch:
		return res
	case <-time.After(limit):
		require.FailNow(t, "no answer in time", "waited %v", limit)
	}
	var zero T
	return zero
}

func TestThePushLoopRetriesAFailedPushOnItsOwn(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	svc.retryEvery = 10 * time.Millisecond
	failedPush(t, dir, svc)
	fixRemote(t, dir, bare)

	// act
	stop := runPushLoop(t, svc)
	waitForSync(t, svc)
	stop()

	// assert
	assert.Equal(t, localHead(t, dir), headOf(t, bare))
	assert.Equal(t, SyncState{}, svc.SyncState())
}

func TestARestartOfflineStillRetries(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	failedPush(t, dir, remoteService(t, dir, bare))
	fixRemote(t, dir, bare)
	away := bare + ".away"
	require.NoError(t, os.Rename(bare, away))
	svc := remoteService(t, dir, bare)
	svc.retryEvery = 10 * time.Millisecond

	// act
	require.NoError(t, svc.Reconcile(t.Context(), "alex"))
	require.Error(t, svc.Sync(t.Context()))
	offline := svc.SyncState()
	require.True(t, offline.Unpublished)
	require.True(t, offline.Retrying)
	require.NoError(t, os.Rename(away, bare))
	stop := runPushLoop(t, svc)
	waitForSync(t, svc)
	stop()

	// assert
	assert.Equal(t, localHead(t, dir), headOf(t, bare))
}

func TestARefusedFetchStopsTheRetry(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	svc.retryEvery = 10 * time.Millisecond
	failedPush(t, dir, svc)
	gitIn(t, dir, "remote", "set-url", remoteName, originAnswering(http.StatusUnauthorized)(t))

	// act
	stop := runPushLoop(t, svc)
	require.Eventually(t, func() bool { return svc.SyncState().Refused }, 10*time.Second, 20*time.Millisecond)
	stop()
	state := svc.SyncState()

	// assert
	assert.True(t, strings.HasPrefix(state.Error, "fetch:"), state.Error)
	assert.True(t, state.Unpublished)
	assert.False(t, state.Retrying)
}

func TestAWorkingFetchClearsARefusal(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare, func(rm *Remote) { rm.PullOnly = true })
	gitIn(t, dir, "remote", "set-url", remoteName, originAnswering(http.StatusUnauthorized)(t))
	require.Error(t, svc.Sync(t.Context()))
	require.True(t, svc.SyncState().Refused)
	fixRemote(t, dir, bare)

	// act
	err := svc.Sync(t.Context())

	// assert
	require.NoError(t, err)
	assert.Equal(t, SyncState{}, svc.SyncState())
}

func TestAWorkingFetchClearsARefusalWhenTheMergeFails(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	gitIn(t, dir, "remote", "set-url", remoteName, originAnswering(http.StatusUnauthorized)(t))
	require.Error(t, svc.Sync(t.Context()))
	require.True(t, svc.SyncState().Refused)
	fixRemote(t, dir, bare)
	pushFromElsewhere(t, bare, "later.md", "# Later\n")
	writeFile(t, dir, "later.md", "# In the way\n")

	// act
	err := svc.Sync(t.Context())
	state := svc.SyncState()

	// assert
	require.Error(t, err)
	assert.True(t, strings.HasPrefix(state.Error, mergeStage+":"), state.Error)
	assert.False(t, state.Diverged)
	assert.False(t, state.Refused)
}

func TestAFetchThatFailsForAnotherReasonDropsAPushRefusal(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	writeFile(t, dir, "mine.md", "# Mine\n")
	gitIn(t, dir, "remote", "set-url", remoteName, originAnswering(http.StatusForbidden)(t))
	require.NoError(t, svc.Reconcile(t.Context(), "alex"))
	require.Error(t, svc.pushNow(t.Context()))
	require.True(t, strings.HasPrefix(svc.SyncError(), "push:"), svc.SyncError())
	require.True(t, svc.SyncState().Refused)
	breakRemote(t, dir)

	// act
	err := svc.Sync(t.Context())
	state := svc.SyncState()

	// assert
	require.Error(t, err)
	assert.True(t, strings.HasPrefix(state.Error, "fetch:"), state.Error)
	assert.False(t, state.Refused)
	assert.True(t, state.Retrying)
}

func TestTheLoopRetriesAWriteWhosePushFailed(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	svc.pushDelay = 10 * time.Millisecond
	svc.retryEvery = 10 * time.Millisecond
	breakRemote(t, dir)
	stop := runPushLoop(t, svc)
	writeFile(t, dir, "local.md", "# Local\n")

	// act
	require.NoError(t, svc.Record(t.Context(), Op{Message: "save", Paths: []string{"local.md"}},
		func() ([]string, error) { return nil, nil }))
	require.Eventually(t, func() bool { return svc.SyncState().Retrying }, 10*time.Second, 10*time.Millisecond)
	fixRemote(t, dir, bare)
	waitForSync(t, svc)
	stop()

	// assert
	assert.Equal(t, localHead(t, dir), headOf(t, bare))
	assert.Equal(t, SyncState{}, svc.SyncState())
}

func TestADivergedSpaceIsNotRetried(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	diverge(t, svc, bare, map[string]string{"mine.md": "# Mine\n"})
	pushFromElsewhere(t, bare, "later.md", "# Later\n")
	tracking := strings.TrimSpace(gitIn(t, dir, "rev-parse", remoteName+"/"+initialBranch))
	remoteHead := headOf(t, bare)

	// act
	svc.retryIfDue(t.Context())

	// assert
	assert.Equal(t, tracking, strings.TrimSpace(gitIn(t, dir, "rev-parse", remoteName+"/"+initialBranch)))
	assert.Equal(t, remoteHead, headOf(t, bare))
	assert.True(t, svc.SyncState().Diverged)
	assert.False(t, svc.SyncState().Retrying)
}

func TestRetryingFollowsTheState(t *testing.T) {
	tests := []struct {
		name     string
		pullOnly bool
		state    SyncState
		expected bool
	}{
		{name: "a failed push with commits waiting", state: SyncState{Unpublished: true, Error: "push: down"}, expected: true},
		{name: "an error with nothing waiting", state: SyncState{Error: "push: down"}},
		{name: "a diverged branch", state: SyncState{Unpublished: true, Error: "merge: diverged", Diverged: true}},
		{name: "a refused credential", state: SyncState{Unpublished: true, Error: "push: refused", Refused: true}},
		{name: "commits waiting and no error", state: SyncState{Unpublished: true}},
		{name: "a pull-only space", pullOnly: true, state: SyncState{Unpublished: true, Error: "fetch: down"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			bare := bareRemote(t)
			dir := cloneOf(t, bare)
			svc := remoteService(t, dir, bare, func(rm *Remote) { rm.PullOnly = tc.pullOnly })

			// act
			svc.publish(tc.state)

			// assert
			assert.Equal(t, tc.expected, svc.SyncState().Retrying)
		})
	}
}

func TestARunningRetryIsPushing(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	svc.retryEvery = 10 * time.Millisecond
	failedPush(t, dir, svc)
	origin, hit, release := stalledOrigin(t)
	gitIn(t, dir, "remote", "set-url", remoteName, origin)

	// act
	stop := runPushLoop(t, svc)
	waitForHit(t, hit)
	during := svc.SyncState().Pushing
	release()
	stop()

	// assert
	assert.True(t, during)
	assert.False(t, svc.SyncState().Pushing)
}

func TestARetryKeepsTheMarkOfAWrite(t *testing.T) {
	for _, marked := range []bool{true, false} {
		t.Run(fmt.Sprintf("marked %v", marked), func(t *testing.T) {
			// arrange
			bare := bareRemote(t)
			dir := cloneOf(t, bare)
			svc := remoteService(t, dir, bare)
			failedPush(t, dir, svc)
			if marked {
				svc.markPush()
			}

			// act
			svc.retryIfDue(t.Context())

			// assert
			assert.Equal(t, marked, svc.SyncState().Pushing)
			assert.True(t, strings.HasPrefix(svc.SyncError(), "fetch:"), svc.SyncError())
			assert.True(t, svc.SyncState().Retrying)
		})
	}
}

func TestACanceledRetryEndsSending(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	svc.retryEvery = 10 * time.Millisecond
	failedPush(t, dir, svc)
	origin, hit, _ := stalledOrigin(t)
	gitIn(t, dir, "remote", "set-url", remoteName, origin)
	stop := runPushLoop(t, svc)

	// act
	waitForHit(t, hit)
	stop()

	// assert
	assert.False(t, svc.SyncState().Pushing)
}

const answerLimit = 5 * time.Second

func TestARecordDoesNotWaitForAStalledFetch(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	origin, hit, release := stalledOrigin(t)
	gitIn(t, dir, "remote", "set-url", remoteName, origin)
	synced := make(chan error, 1)
	go func() { synced <- svc.Sync(t.Context()) }()
	waitForHit(t, hit)
	before := localHead(t, dir)
	writeFile(t, dir, "local.md", "# Local\n")

	// act
	err := within(t, answerLimit, saveAsync(t.Context(), svc, "local.md", false))

	// assert
	require.NoError(t, err)
	assert.NotEqual(t, before, localHead(t, dir))
	release()
	assert.Error(t, within(t, answerLimit, synced))
}

func TestARecordDoesNotWaitForAStalledPush(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	origin, hit, release := gatedOrigin(t, bare, "git-receive-pack")
	gitIn(t, dir, "remote", "set-url", remoteName, origin)
	svc.pushDelay = 10 * time.Millisecond
	stop := runPushLoop(t, svc)
	writeFile(t, dir, "first.md", "# First\n")
	require.NoError(t, within(t, answerLimit, saveAsync(t.Context(), svc, "first.md", false)))
	waitForHit(t, hit)
	writeFile(t, dir, "second.md", "# Second\n")

	// act
	err := within(t, answerLimit, saveAsync(t.Context(), svc, "second.md", false))

	// assert
	require.NoError(t, err)
	release()
	require.Eventually(t, func() bool { return !svc.SyncState().Pushing }, 10*time.Second, 20*time.Millisecond)
	stop()
	assert.Equal(t, localHead(t, dir), headOf(t, bare))
	assert.Equal(t, SyncState{}, svc.SyncState())
}

func TestATokenWriteWaitsForItsPushWithoutTheHistoryLock(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	origin, hit, release := gatedOrigin(t, bare, "git-receive-pack")
	gitIn(t, dir, "remote", "set-url", remoteName, origin)
	writeFile(t, dir, "strict.md", "# Strict\n")
	strict := saveAsync(t.Context(), svc, "strict.md", true)
	waitForHit(t, hit)
	writeFile(t, dir, "browser.md", "# Browser\n")

	// act
	browserErr := within(t, answerLimit, saveAsync(t.Context(), svc, "browser.md", false))
	strictDoneEarly := len(strict) > 0
	release()
	strictErr := within(t, answerLimit, strict)

	// assert
	require.NoError(t, browserErr)
	assert.False(t, strictDoneEarly, "the token write waits for its push")
	require.NoError(t, strictErr)
	onRemote := gitIn(t, bare, "ls-tree", "--name-only", initialBranch)
	assert.Contains(t, onRemote, "strict.md")
	assert.NotContains(t, onRemote, "browser.md", "the push sent the HEAD it started with")
	assert.Len(t, svc.pushes, 1)
	assert.True(t, svc.SyncState().Pushing)
}

func TestACanceledTokenWriteLeavesItsPushToTheLoop(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	origin, hit, release := gatedOrigin(t, bare, "git-receive-pack")
	gitIn(t, dir, "remote", "set-url", remoteName, origin)
	svc.pushDelay = 10 * time.Millisecond
	stop := runPushLoop(t, svc)
	ctx, cancel := context.WithCancel(t.Context())
	writeFile(t, dir, "strict.md", "# Strict\n")
	strict := saveAsync(ctx, svc, "strict.md", true)
	waitForHit(t, hit)

	// act
	cancel()
	err := within(t, gitWaitDelay+answerLimit, strict)
	release()

	// assert
	require.ErrorIs(t, err, ErrNotPublished)
	require.Eventually(t, func() bool { return !svc.SyncState().Pushing }, 10*time.Second, 20*time.Millisecond)
	stop()
	assert.Equal(t, localHead(t, dir), headOf(t, bare))
}

func TestAWriteDuringAPushStaysPushing(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	origin, hit, release := gatedOrigin(t, bare, "git-receive-pack")
	gitIn(t, dir, "remote", "set-url", remoteName, origin)
	svc.pushDelay = 0
	writeFile(t, dir, "first.md", "# First\n")
	require.NoError(t, within(t, answerLimit, saveAsync(t.Context(), svc, "first.md", false)))
	pushed := make(chan bool, 1)
	go func() { pushed <- svc.pushAfterDelay(t.Context()) }()
	waitForHit(t, hit)
	writeFile(t, dir, "second.md", "# Second\n")

	// act
	require.NoError(t, within(t, answerLimit, saveAsync(t.Context(), svc, "second.md", false)))
	release()
	ran := within(t, answerLimit, pushed)

	// assert
	assert.True(t, ran)
	assert.True(t, svc.SyncState().Pushing)
	assert.Len(t, svc.pushes, 1)
}

func TestAWriteDuringASyncReadsAsPushing(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	origin, hit, release := gatedOrigin(t, bare, "git-receive-pack")
	gitIn(t, dir, "remote", "set-url", remoteName, origin)
	writeFile(t, dir, "first.md", "# First\n")
	require.NoError(t, svc.Reconcile(t.Context(), "alex"))
	synced := make(chan error, 1)
	go func() { synced <- svc.Sync(t.Context()) }()
	waitForHit(t, hit)
	writeFile(t, dir, "second.md", "# Second\n")

	// act
	require.NoError(t, within(t, answerLimit, saveAsync(t.Context(), svc, "second.md", false)))
	release()
	err := within(t, answerLimit, synced)

	// assert
	require.NoError(t, err)
	state := svc.SyncState()
	assert.True(t, state.Unpublished)
	assert.True(t, state.Pushing)
}

func TestAWaitingPushStopsWithItsContext(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	origin, hit, _ := gatedOrigin(t, bare, "git-receive-pack")
	gitIn(t, dir, "remote", "set-url", remoteName, origin)
	svc.pushDelay = 0
	request, cancelRequest := context.WithCancel(t.Context())
	writeFile(t, dir, "strict.md", "# Strict\n")
	strict := saveAsync(request, svc, "strict.md", true)
	waitForHit(t, hit)
	workers, cancelWorkers := context.WithCancel(t.Context())
	pushed := make(chan bool, 1)
	go func() { pushed <- svc.pushAfterDelay(workers) }()

	// act
	cancelWorkers()
	cancelRequest()

	// assert
	limit := gitWaitDelay + answerLimit
	require.ErrorIs(t, within(t, limit, strict), ErrNotPublished)
	assert.False(t, within(t, limit, pushed))
}

func TestTheWatcherLeavesThePushToTheLoop(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	before := headOf(t, bare)
	writeFile(t, dir, "outside.md", "# Outside\n")

	// act
	require.NoError(t, svc.Reconcile(t.Context(), "external"))

	// assert
	assert.Equal(t, before, headOf(t, bare))
	assert.NotEqual(t, before, localHead(t, dir))
	assert.Len(t, svc.pushes, 1)
	assert.False(t, svc.SyncState().Pushing)
}

func TestACanceledGitDoesNotWaitForItsHelper(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	origin, hit, _ := stalledOrigin(t)
	gitIn(t, dir, "remote", "set-url", remoteName, origin)
	ctx, cancel := context.WithCancel(t.Context())
	fetched := make(chan error, 1)
	go func() {
		_, err := svc.run(ctx, command{args: []string{"fetch", remoteName, initialBranch}, network: true})
		fetched <- err
	}()
	waitForHit(t, hit)

	// act
	cancel()

	// assert
	assert.Error(t, within(t, gitWaitDelay+answerLimit, fetched))
}
