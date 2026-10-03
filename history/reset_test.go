package history

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// diverge leaves the service with a commit the remote lacks and the remote
// with a commit the service lacks, and lets a sync find that out.
func diverge(t *testing.T, svc *Service, bare string, mine map[string]string) {
	t.Helper()
	breakRemote(t, svc.Root())
	require.NoError(t, record(t, svc, Op{Actor: "alex", Paths: keysOf(mine)}, mine))
	fixRemote(t, svc.Root(), bare)
	pushFromElsewhere(t, bare, "theirs.md", "# Theirs\n")
	require.Error(t, svc.Sync(t.Context()))
	require.True(t, svc.SyncState().Diverged)
}

func keysOf(files map[string]string) []string {
	res := make([]string, 0, len(files))
	for name := range files {
		res = append(res, name)
	}
	return res
}

// rewriteOrigin is a force-push: the branch gets a new history that holds the
// same notes plus one more, which is what a rebase upstream looks like.
func rewriteOrigin(t *testing.T, bare, name, content string) {
	t.Helper()
	other := filepath.Join(t.TempDir(), "rewriter")
	require.NoError(t, Clone(t.Context(), other, Remote{URL: bare, Branch: initialBranch}))
	writeFile(t, other, name, content)
	gitIn(t, other, "add", name)
	gitIn(t, other, "-c", "user.name=other", "-c", "user.email=other@x", "commit", "--quiet", "--amend", "-m", "rewritten")
	gitIn(t, other, "push", "--quiet", "--force", remoteName, initialBranch)
}

func pullOnly(rm *Remote) { rm.PullOnly = true }

func backups(t *testing.T, dir string) []string {
	t.Helper()
	return strings.Fields(gitIn(t, dir, "for-each-ref", "--format=%(refname:short)", "refs/heads/"+backupPrefix))
}

// TestAFailedMergeIsNotADivergence is why Diverged is measured: the stage word
// is the same, and offering a reset for a file in the way would be offering to
// throw a healthy copy away.
func TestAFailedMergeIsNotADivergence(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare, pullOnly)
	writeFile(t, dir, "theirs.md", "# Left here by hand\n")
	pushFromElsewhere(t, bare, "theirs.md", "# Theirs\n")

	// act
	err := svc.Sync(t.Context())

	// assert
	require.Error(t, err)
	state := svc.SyncState()
	assert.True(t, strings.HasPrefix(state.Error, "merge:"), state.Error)
	assert.False(t, state.Diverged)
}

// TestASaveKeepsTheDivergenceOnScreen covers the push a save used to try: the
// remote refuses it every time, and its error replaced the divergence until the
// next fetch.
func TestASaveKeepsTheDivergenceOnScreen(t *testing.T) {
	// arrange
	bare := bareRemote(t)
	dir := cloneOf(t, bare)
	svc := remoteService(t, dir, bare)
	diverge(t, svc, bare, map[string]string{"mine.md": "# Mine\n"})
	before := svc.SyncState()

	// act
	err := record(t, svc, Op{Actor: "alex", Paths: []string{"more.md"}}, map[string]string{"more.md": "# More\n"})

	// assert
	require.NoError(t, err)
	after := svc.SyncState()
	assert.Equal(t, before.Error, after.Error)
	assert.True(t, after.Diverged)
	assert.Equal(t, []string{"mine.md", "more.md"}, after.Unsynced.Paths)
}

func TestCheckDivergence(t *testing.T) {
	t.Run("lists what only this copy holds", func(t *testing.T) {
		// arrange
		bare := bareRemote(t)
		dir := cloneOf(t, bare)
		svc := remoteService(t, dir, bare)
		diverge(t, svc, bare, map[string]string{"mine.md": "# Mine\n"})

		// act
		res, err := svc.CheckDivergence(t.Context())

		// assert
		require.NoError(t, err)
		assert.Equal(t, Divergence{
			Head:   localHead(t, dir),
			Remote: headOf(t, bare),
			Lost:   Unsynced{Paths: []string{"mine.md"}},
		}, res)
	})

	t.Run("finds nothing to lose after a rewrite upstream", func(t *testing.T) {
		// arrange
		bare := bareRemote(t)
		dir := cloneOf(t, bare)
		svc := remoteService(t, dir, bare, pullOnly)
		rewriteOrigin(t, bare, "added.md", "# Added\n")

		// act
		res, err := svc.CheckDivergence(t.Context())

		// assert
		require.NoError(t, err)
		assert.Equal(t, Divergence{Head: localHead(t, dir), Remote: headOf(t, bare), Clean: true, Lost: Unsynced{Paths: []string{}}}, res)
	})

	t.Run("counts a deletion the remote edited over", func(t *testing.T) {
		// arrange
		bare := bareRemote(t)
		dir := cloneOf(t, bare)
		svc := remoteService(t, dir, bare)
		breakRemote(t, dir)
		require.NoError(t, svc.Record(t.Context(), Op{Actor: "alex", Paths: []string{"index.md"}}, func() ([]string, error) {
			return nil, os.Remove(filepath.Join(dir, "index.md"))
		}))
		fixRemote(t, dir, bare)
		pushFromElsewhere(t, bare, "index.md", "# Seed\n\nedited upstream\n")

		// act
		res, err := svc.CheckDivergence(t.Context())

		// assert
		require.NoError(t, err)
		assert.False(t, res.Clean, "the merged tree equals the remote, and the deletion is still lost")
		assert.Equal(t, Unsynced{Paths: []string{"index.md"}}, res.Lost)
	})

	t.Run("hides what the store hides and still refuses to call it clean", func(t *testing.T) {
		// arrange
		bare := bareRemote(t)
		dir := cloneOf(t, bare)
		svc := serviceAt(t, dir, func(cfg *Config) {
			cfg.Remote = &Remote{URL: bare, Branch: initialBranch}
			cfg.TrackAll = true
			cfg.Visible = func(p string) bool { return p != "secret.md" }
		})
		diverge(t, svc, bare, map[string]string{"secret.md": "# Secret\n"})

		// act
		res, err := svc.CheckDivergence(t.Context())

		// assert
		require.NoError(t, err)
		assert.False(t, res.Clean)
		assert.Equal(t, Unsynced{Paths: []string{}}, res.Lost)
	})

	t.Run("refuses to answer about a remote it could not reach", func(t *testing.T) {
		// arrange
		bare := bareRemote(t)
		dir := cloneOf(t, bare)
		svc := remoteService(t, dir, bare)
		diverge(t, svc, bare, map[string]string{"mine.md": "# Mine\n"})
		breakRemote(t, dir)

		// act
		_, err := svc.CheckDivergence(t.Context())

		// assert
		require.Error(t, err)
		require.NotErrorIs(t, err, ErrNotDiverged)
		assert.Contains(t, svc.SyncError(), "fetch:")
	})

	t.Run("answers that a project in step has nothing to reset", func(t *testing.T) {
		// arrange
		bare := bareRemote(t)
		svc := remoteService(t, cloneOf(t, bare), bare)

		// act
		_, err := svc.CheckDivergence(t.Context())

		// assert
		require.ErrorIs(t, err, ErrNotDiverged)
	})

	t.Run("answers the same for a project with no remote", func(t *testing.T) {
		// arrange
		svc := newService(t)

		// act
		_, err := svc.CheckDivergence(t.Context())

		// assert
		require.ErrorIs(t, err, ErrNotDiverged)
	})

	t.Run("never runs a merge driver the repository configures", func(t *testing.T) {
		// arrange
		bare := bareRemote(t)
		dir := cloneOf(t, bare)
		marker := filepath.Join(t.TempDir(), "driver-ran")
		script := filepath.Join(t.TempDir(), "merge.sh")
		require.NoError(t, os.WriteFile(script, []byte("#!/bin/sh\ntouch "+marker+"\nexit 0\n"), 0o700))
		gitIn(t, dir, "config", "merge.evil.driver", script+" %O %A %B")
		gitIn(t, dir, "config", "merge.default", "evil")
		svc := remoteService(t, dir, bare)
		breakRemote(t, dir)
		edits := map[string]string{"index.md": "# Seed\n\nedited here\n", ".gitattributes": "* merge=evil\n"}
		require.NoError(t, record(t, svc, Op{Actor: "alex", Paths: keysOf(edits)}, edits))
		fixRemote(t, dir, bare)
		pushFromElsewhere(t, bare, "index.md", "# Seed upstream\n")
		require.Error(t, svc.Sync(t.Context()))

		// act
		_, err := svc.CheckDivergence(t.Context())

		// assert
		require.NoError(t, err)
		assert.NoFileExists(t, marker)
	})
}

func TestANilServiceHasNothingToReset(t *testing.T) {
	// arrange
	var svc *Service

	// act
	_, checkErr := svc.CheckDivergence(t.Context())
	_, resetErr := svc.ResetToRemote(t.Context(), ResetOp{})

	// assert
	require.ErrorIs(t, checkErr, ErrDisabled)
	require.ErrorIs(t, resetErr, ErrDisabled)
}

func TestResetToRemote(t *testing.T) {
	t.Run("moves to the remote and keeps what was here in a backup", func(t *testing.T) {
		// arrange
		bare := bareRemote(t)
		dir := cloneOf(t, bare)
		svc := remoteService(t, dir, bare)
		diverge(t, svc, bare, map[string]string{"mine.md": "# Mine\n"})
		was := localHead(t, dir)

		// act
		res, err := svc.ResetToRemote(t.Context(), ResetOp{Actor: "alex", Head: was, Remote: headOf(t, bare)})

		// assert
		require.NoError(t, err)
		assert.Equal(t, headOf(t, bare), localHead(t, dir))
		assert.NoFileExists(t, filepath.Join(dir, "mine.md"))
		assert.FileExists(t, filepath.Join(dir, "theirs.md"))
		assert.Equal(t, ResetResult{Backup: backups(t, dir)[0]}, res)
		assert.True(t, strings.HasPrefix(res.Backup, backupPrefix), res.Backup)
		assert.Equal(t, was, strings.TrimSpace(gitIn(t, dir, "rev-parse", res.Backup)))
		assert.Equal(t, SyncState{}, svc.SyncState())
		assert.NotContains(t, gitIn(t, bare, "for-each-ref"), backupPrefix, "nobody asked for it on the remote")
	})

	t.Run("sends the backup to the remote when asked", func(t *testing.T) {
		// arrange
		bare := bareRemote(t)
		dir := cloneOf(t, bare)
		svc := remoteService(t, dir, bare)
		diverge(t, svc, bare, map[string]string{"mine.md": "# Mine\n"})
		was := localHead(t, dir)

		// act
		res, err := svc.ResetToRemote(t.Context(), ResetOp{Actor: "alex", Head: was, Remote: headOf(t, bare), PushBackup: true})

		// assert
		require.NoError(t, err)
		assert.True(t, res.BackupPushed)
		assert.Equal(t, was, strings.TrimSpace(gitIn(t, bare, "rev-parse", res.Backup)))
	})

	t.Run("does not reset when the backup cannot reach the remote", func(t *testing.T) {
		// arrange
		bare := bareRemote(t)
		dir := cloneOf(t, bare)
		svc := remoteService(t, dir, bare)
		diverge(t, svc, bare, map[string]string{"mine.md": "# Mine\n"})
		was := localHead(t, dir)
		hook := filepath.Join(bare, "hooks", "pre-receive")
		require.NoError(t, os.MkdirAll(filepath.Dir(hook), 0o750))
		require.NoError(t, os.WriteFile(hook, []byte("#!/bin/sh\nexit 1\n"), 0o700))

		// act
		_, err := svc.ResetToRemote(t.Context(), ResetOp{Actor: "alex", Head: was, Remote: headOf(t, bare), PushBackup: true})

		// assert
		require.Error(t, err)
		assert.Equal(t, was, localHead(t, dir))
		assert.FileExists(t, filepath.Join(dir, "mine.md"))
		assert.True(t, svc.SyncState().Diverged)
	})

	t.Run("keeps no backup when nothing would be lost", func(t *testing.T) {
		// arrange
		bare := bareRemote(t)
		dir := cloneOf(t, bare)
		svc := remoteService(t, dir, bare, pullOnly)
		rewriteOrigin(t, bare, "added.md", "# Added\n")
		require.Error(t, svc.Sync(t.Context()))

		// act
		res, err := svc.ResetToRemote(t.Context(), ResetOp{Head: localHead(t, dir), Remote: headOf(t, bare)})

		// assert
		require.NoError(t, err)
		assert.Equal(t, ResetResult{}, res)
		assert.Empty(t, backups(t, dir))
		assert.Equal(t, headOf(t, bare), localHead(t, dir))
		assert.FileExists(t, filepath.Join(dir, "added.md"))
	})

	t.Run("puts what was only on disk into the backup", func(t *testing.T) {
		// arrange
		bare := bareRemote(t)
		dir := cloneOf(t, bare)
		svc := remoteService(t, dir, bare)
		diverge(t, svc, bare, map[string]string{"mine.md": "# Mine\n"})
		draft := "# Mine\n\nedited over a share, never committed\n"
		writeFile(t, dir, "mine.md", draft)

		// act
		res, err := svc.ResetToRemote(t.Context(), ResetOp{Actor: "alex", Head: localHead(t, dir), Remote: headOf(t, bare)})

		// assert
		require.NoError(t, err)
		assert.Equal(t, draft, gitIn(t, dir, "show", res.Backup+":mine.md"))
		assert.False(t, svc.Degraded())
	})

	t.Run("refuses a state the caller did not check", func(t *testing.T) {
		// arrange
		bare := bareRemote(t)
		dir := cloneOf(t, bare)
		svc := remoteService(t, dir, bare)
		diverge(t, svc, bare, map[string]string{"mine.md": "# Mine\n"})
		was := localHead(t, dir)
		checked := headOf(t, bare)
		pushFromElsewhere(t, bare, "later.md", "# Later\n")

		// act
		_, err := svc.ResetToRemote(t.Context(), ResetOp{Actor: "alex", Head: was, Remote: checked})

		// assert
		require.ErrorIs(t, err, ErrStateChanged)
		assert.Equal(t, was, localHead(t, dir))
		assert.Empty(t, backups(t, dir))
	})

	t.Run("refuses a project that is back in step", func(t *testing.T) {
		// arrange
		bare := bareRemote(t)
		dir := cloneOf(t, bare)
		svc := remoteService(t, dir, bare)

		// act
		_, err := svc.ResetToRemote(t.Context(), ResetOp{Head: localHead(t, dir), Remote: headOf(t, bare)})

		// assert
		require.ErrorIs(t, err, ErrNotDiverged)
	})

	// git replaces an ignored file without a word, and the store serves files a
	// .gitignore among the notes names
	t.Run("refuses to write over an ignored file git does not track", func(t *testing.T) {
		// arrange
		bare := bareRemote(t)
		dir := cloneOf(t, bare)
		svc := remoteService(t, dir, bare, pullOnly)
		writeFile(t, dir, ".git/info/exclude", "added.md\n")
		writeFile(t, dir, "added.md", "# Left here by hand\n")
		rewriteOrigin(t, bare, "added.md", "# Added\n")
		require.Error(t, svc.Sync(t.Context()))
		was := localHead(t, dir)

		// act
		_, err := svc.ResetToRemote(t.Context(), ResetOp{Head: was, Remote: headOf(t, bare)})

		// assert
		require.ErrorIs(t, err, ErrResetRefused)
		assert.Contains(t, err.Error(), "added.md")
		assert.Equal(t, was, localHead(t, dir))
		kept, readErr := os.ReadFile(filepath.Join(dir, "added.md"))
		require.NoError(t, readErr)
		assert.Equal(t, "# Left here by hand\n", string(kept))
	})

	t.Run("refuses to write over an uncommitted change it cannot record", func(t *testing.T) {
		// arrange
		bare := bareRemote(t)
		dir := cloneOf(t, bare)
		svc := remoteService(t, dir, bare, pullOnly)
		rewriteOrigin(t, bare, "index.md", "# Seed, rewritten\n")
		writeFile(t, dir, "index.md", "# Seed, edited by hand\n")
		require.Error(t, svc.Sync(t.Context()))
		was := localHead(t, dir)

		// act
		_, err := svc.ResetToRemote(t.Context(), ResetOp{Head: was, Remote: headOf(t, bare)})

		// assert
		require.ErrorIs(t, err, ErrResetRefused)
		assert.Equal(t, was, localHead(t, dir))
	})
}
