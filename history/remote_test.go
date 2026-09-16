package history

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// bareRemote makes an origin nothing has to reach the network for: a bare
// repository in a temp directory, seeded with one commit on the branch.
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

// cloneOf makes a working clone of a bare origin, the way main does at startup.
func cloneOf(t *testing.T, bare string) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "notes")
	require.NoError(t, Clone(t.Context(), dir, Remote{URL: bare, Branch: initialBranch}))
	return dir
}

// remoteService is a service over a clone, with the remote configured the way
// main configures one for a project whose directory is a clone.
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

// headOf reads the commit the remote's branch points at.
func headOf(t *testing.T, bare string) string {
	t.Helper()
	return strings.TrimSpace(gitIn(t, bare, "rev-parse", initialBranch))
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
	staging, err := filepath.Glob(filepath.Join(filepath.Dir(dir), ".scrawl-clone-*"))
	require.NoError(t, err)
	assert.Empty(t, staging, "the staging directory is gone whether the clone worked or not")
}

func TestCloneRefusesAMissingBranch(t *testing.T) {
	// arrange
	bare := bareRemote(t)

	// act
	err := Clone(t.Context(), filepath.Join(t.TempDir(), "notes"), Remote{URL: bare, Branch: "nope"})

	// assert
	require.Error(t, err)
	assert.NoDirExists(t, filepath.Join(t.TempDir(), "notes"))
}

// TestNewRefusesAClonePointedElsewhere is why an existing clone is verified and
// never repaired: re-cloning or repointing would throw away commits that were
// never pushed.
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

	// assert
	assert.False(t, svc.Unpublished(), "the reconcile pushed what it committed")
	assert.Empty(t, svc.SyncError())
	assert.Contains(t, gitIn(t, bare, "ls-tree", "--name-only", initialBranch), "local.md")
}

// TestSyncMergesWhatTheRemoteGained is the reason the startup order is fixed:
// a fast forward that landed after the watcher started would produce no event
// and the index would stay stale for the life of the process.
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

// TestAFailedPushSurvivesASaveThatStagesNothing is the trap the two states
// exist for: commitLocked succeeds when nothing is staged and clears degraded,
// which would report a healthy history while the remote was still behind.
func TestAFailedPushSurvivesASaveThatStagesNothing(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	writeFile(t, dir, "local.md", "# Local\n")
	require.NoError(t, svc.Reconcile(t.Context(), "alex"))

	// act
	writeFile(t, dir, "second.md", "# Second\n")
	breakRemote(t, dir)
	require.NoError(t, svc.Reconcile(t.Context(), "alex"))
	unpublishedAfterPush := svc.Unpublished()
	// a save that changes nothing git can see: the commit succeeds with an
	// empty index and clears degraded
	require.NoError(t, svc.Record(t.Context(), Op{Message: "touch", Paths: []string{"second.md"}},
		func() ([]string, error) { return nil, nil }))

	// assert
	assert.True(t, unpublishedAfterPush)
	assert.False(t, svc.Degraded(), "the commit landed, so the commit state is healthy")
	assert.True(t, svc.Unpublished(), "the remote is still behind")
	assert.Contains(t, svc.SyncError(), "push:")
}

// TestUnpublishedIsMeasuredNotRemembered covers the fresh process: a clone left
// ahead of origin by the previous run would report itself published until
// somebody saved something, if the flag were only set by a failed push.
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

// TestADivergedBranchIsLoudAndNeverPushed is the whole conflict policy: no
// merge, no rebase, no resolution. The fetch succeeds, the ff-only merge fails
// and no push is attempted, so only a measurement can report the divergence.
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
	assert.Contains(t, svc.SyncError(), "git pull --rebase")
	assert.Equal(t, before, headOf(t, bare), "nothing was pushed over the divergence")
}

// TestAnIgnoredButVisibleFileStillReachesTheRemote is what git add -f closes.
// Ignore rules win over an exact pathspec by design, so widening versioned
// alone would leave a file the store shows, the app serves and the editor
// writes unpushable, silently.
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

	// assert
	assert.Contains(t, gitIn(t, bare, "ls-tree", "--name-only", initialBranch), "config.toml")
	assert.False(t, svc.Unpublished())
}

// TestPullOnlyNeverWritesToGit is the read-only remote: nothing in the code
// implies it, so it is written down. A public repository configured read-only
// would otherwise keep committing and pushing into a remote it has no
// credentials for, and report itself unpublished for changes nobody made.
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

// TestGitErrorRedactsTheCredential is structural rather than a log filter,
// because SyncError puts this text on a page, which lgr.Secret never touches.
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

// TestTheTokenReachesOnlyTheNetworkCommands is why env takes a flag: scrawl's
// own environment is inherited by every git call, so a token handed to all of
// them would ride along on git log and git status too.
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

// pushFromElsewhere is a second writer: a clone of its own that commits and
// pushes, which is what makes the branch move under the service.
func pushFromElsewhere(t *testing.T, bare, name, content string) {
	t.Helper()
	other := filepath.Join(t.TempDir(), "other")
	require.NoError(t, Clone(t.Context(), other, Remote{URL: bare, Branch: initialBranch}))
	writeFile(t, other, name, content)
	gitIn(t, other, "add", name)
	gitIn(t, other, "-c", "user.name=other", "-c", "user.email=other@x", "commit", "--quiet", "-m", "from elsewhere")
	gitIn(t, other, "push", "--quiet", remoteName, initialBranch)
}

// breakRemote points origin at nothing, which is the offline remote every test
// about a failed conversation needs and no network can provide.
func breakRemote(t *testing.T, dir string) {
	t.Helper()
	gitIn(t, dir, "remote", "set-url", remoteName, filepath.Join(t.TempDir(), "gone.git"))
}

func fixRemote(t *testing.T, dir, bare string) {
	t.Helper()
	gitIn(t, dir, "remote", "set-url", remoteName, bare)
}
