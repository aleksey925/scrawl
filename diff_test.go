package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/htmldiff"
	"github.com/aleksey925/scrawl/page"
)

func gitRepoAt(t *testing.T) string {
	t.Helper()

	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	dir, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	runGit(t, dir, "init", "-q", "-b", "main")
	t.Chdir(dir)
	return dir
}

func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()

	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=test@example.com",
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null")
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, string(out))
	return strings.TrimSpace(string(out))
}

func commitFiles(t *testing.T, dir, message string, files map[string]string) {
	t.Helper()

	writeTree(t, dir, files)
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "-m", message)
}

func diffJSONOf(t *testing.T, args ...string) (int, diffJSON) {
	t.Helper()

	code, out, errOut := runCLI(t, "", append([]string{"diff", "-f", "json"}, args...)...)
	require.NotEqual(t, 2, code, errOut)
	var got diffJSON
	require.NoError(t, json.Unmarshal([]byte(out), &got), out)
	return code, got
}

func kindsOf(rows []htmldiff.Row) []htmldiff.Kind {
	res := make([]htmldiff.Kind, 0, len(rows))
	for _, row := range rows {
		res = append(res, row.Kind)
	}
	return res
}

func TestRunDiffTwoFiles(t *testing.T) {
	// arrange
	dir := t.TempDir()
	oldFile, newFile := filepath.Join(dir, "old.md"), filepath.Join(dir, "new.md")
	require.NoError(t, os.WriteFile(oldFile, []byte("# Title\n\nThe quick fox.\n"), 0o600))
	require.NoError(t, os.WriteFile(newFile, []byte("# Title\n\nThe slow fox.\n"), 0o600))

	// act
	code, got := diffJSONOf(t, "--exit-code", oldFile, newFile)

	// assert
	assert.Equal(t, 1, code)
	assert.Equal(t, oldFile, got.Old)
	assert.Equal(t, newFile, got.New)
	require.Len(t, got.Files, 1)
	assert.Equal(t, page.Modified, got.Files[0].Status)
	assert.Equal(t, htmldiff.Stats{Changed: 1}, got.Files[0].Stats)
	assert.Equal(t, `<p>The <ins class="diff-ins">slow</ins> fox.</p>`, got.Files[0].Rows[1].New.HTML)
}

func TestRunDiffLayout(t *testing.T) {
	dir := t.TempDir()
	oldFile, newFile := filepath.Join(dir, "old.md"), filepath.Join(dir, "new.md")
	require.NoError(t, os.WriteFile(oldFile, []byte("The quick fox.\n"), 0o600))
	require.NoError(t, os.WriteFile(newFile, []byte("The slow fox.\n"), 0o600))

	tests := []struct {
		name string
		args []string
		want page.Layout
	}{
		{name: "the two versions side by side unless asked otherwise", args: nil, want: page.Split},
		{name: "split", args: []string{"--layout", "split"}, want: page.Split},
		{name: "unified", args: []string{"--layout", "unified"}, want: page.Unified},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			code, out, errOut := runCLI(t, "", append(append([]string{"diff", "-f", "fragment"}, tc.args...),
				oldFile, newFile)...)

			// assert
			assert.Equal(t, 0, code, errOut)
			assert.Contains(t, out, `<div class="diff" data-layout="`+string(tc.want)+`">`)
		})
	}

	t.Run("an unknown layout is refused as a failure and not a difference", func(t *testing.T) {
		// act
		code, _, errOut := runCLI(t, "", "diff", "--layout", "stacked", oldFile, newFile)

		// assert
		assert.Equal(t, 2, code)
		assert.Contains(t, errOut, "stacked")
	})
}

func TestRunDiffExitCode(t *testing.T) {
	// arrange
	dir := t.TempDir()
	oldFile, newFile := filepath.Join(dir, "old.md"), filepath.Join(dir, "new.md")
	require.NoError(t, os.WriteFile(oldFile, []byte("A line\nwrapped.\n"), 0o600))
	require.NoError(t, os.WriteFile(newFile, []byte("A line wrapped.\n"), 0o600))

	// act
	code, got := diffJSONOf(t, "--exit-code", oldFile, newFile)

	// assert
	assert.Equal(t, 0, code)
	assert.Equal(t, []htmldiff.Kind{htmldiff.Format}, kindsOf(got.Files[0].Rows))
}

func TestRunDiffGit(t *testing.T) {
	dir := gitRepoAt(t)
	commitFiles(t, dir, "first", map[string]string{
		"keep.md":        "# Keep\n\nunchanged\n",
		"edit.md":        "# Edit\n\nold words here\n",
		"gone.md":        "# Gone\n",
		"move.md":        "# Moved\n\none two three four five six seven eight\n",
		"docs/deep.md":   "# Deep\n\nfirst\n",
		"code/main.go":   "package main\n",
		"notes.markdown": "# not a document\n",
	})
	base := runGit(t, dir, "rev-parse", "HEAD")
	require.NoError(t, os.Remove(filepath.Join(dir, "move.md")))
	commitFiles(t, dir, "second", map[string]string{
		"edit.md":        "# Edit\n\nnew words here\n",
		"moved.md":       "# Moved\n\none two three four five six seven eight\n",
		"docs/deep.md":   "# Deep\n\nsecond\n",
		"code/main.go":   "package main // changed\n",
		"notes.markdown": "# still not a document\n",
	})
	runGit(t, dir, "rm", "-q", "gone.md")
	runGit(t, dir, "commit", "-q", "-m", "third")

	t.Run("two revisions list every changed note", func(t *testing.T) {
		// act
		_, got := diffJSONOf(t, base, "HEAD")

		// assert
		statuses := map[string]page.Status{}
		for _, file := range got.Files {
			statuses[file.Path] = file.Status
		}
		assert.Equal(t, map[string]page.Status{
			"docs/deep.md": page.Modified,
			"edit.md":      page.Modified,
			"gone.md":      page.Deleted,
			"moved.md":     page.Renamed,
		}, statuses)
		assert.Equal(t, base[:8], got.Old)
		assert.Equal(t, "HEAD", got.New)
	})

	t.Run("a rename names where the note was", func(t *testing.T) {
		// act
		_, got := diffJSONOf(t, base+"..HEAD", "--", "moved.md", "move.md")

		// assert
		require.Len(t, got.Files, 1)
		assert.Equal(t, "move.md", got.Files[0].OldPath)
		assert.Equal(t, []htmldiff.Kind{htmldiff.Same, htmldiff.Same}, kindsOf(got.Files[0].Rows))
	})

	t.Run("paths limit the comparison, relative to where it runs", func(t *testing.T) {
		// arrange
		t.Chdir(filepath.Join(dir, "docs"))

		// act
		_, got := diffJSONOf(t, base, "HEAD", "--", ".")

		// assert
		require.Len(t, got.Files, 1)
		assert.Equal(t, "docs/deep.md", got.Files[0].Path)
	})

	t.Run("no revision is HEAD against the working tree, new notes included", func(t *testing.T) {
		// arrange
		require.NoError(t, os.WriteFile(filepath.Join(dir, "keep.md"), []byte("# Keep\n\nchanged\n"), 0o600))
		require.NoError(t, os.WriteFile(filepath.Join(dir, "fresh.md"), []byte("# Fresh\n"), 0o600))
		t.Cleanup(func() {
			runGit(t, dir, "checkout", "-q", "--", "keep.md")
			_ = os.Remove(filepath.Join(dir, "fresh.md"))
		})

		// act
		_, got := diffJSONOf(t)

		// assert
		assert.Equal(t, "HEAD", got.Old)
		assert.Equal(t, workingTree, got.New)
		require.Len(t, got.Files, 2)
		assert.Equal(t, "fresh.md", got.Files[0].Path)
		assert.Equal(t, page.Added, got.Files[0].Status)
		assert.Equal(t, "keep.md", got.Files[1].Path)
		assert.Equal(t, htmldiff.Stats{Changed: 1}, got.Files[1].Stats)
	})

	t.Run("three dots compare with the merge base", func(t *testing.T) {
		// arrange
		runGit(t, dir, "checkout", "-q", "-b", "side", base)
		commitFiles(t, dir, "side", map[string]string{"side.md": "# Side\n"})
		runGit(t, dir, "checkout", "-q", "main")

		// act
		_, got := diffJSONOf(t, "main...side")

		// assert
		require.Len(t, got.Files, 1)
		assert.Equal(t, "side.md", got.Files[0].Path)
		assert.Equal(t, "main (merge base)", got.Old)
	})

	t.Run("a page lists the files and draws each", func(t *testing.T) {
		// act
		code, out, errOut := runCLI(t, "", "diff", base, "HEAD")

		// assert
		assert.Equal(t, 0, code, errOut)
		assert.Contains(t, out, `<ul class="page-files">`)
		assert.Contains(t, out, `<div class="page-moved">move.md → moved.md</div>`)
		assert.Contains(t, out, `<del class="diff-del">old</del>`)
	})

	t.Run("an unknown revision is an error and not a difference", func(t *testing.T) {
		// act
		code, _, errOut := runCLI(t, "", "diff", "no-such-rev")

		// assert
		assert.Equal(t, 2, code)
		assert.Equal(t, "scrawl diff: \"no-such-rev\" is not a revision\n", errOut)
	})

	t.Run("a path outside the repository is refused", func(t *testing.T) {
		// act
		code, _, errOut := runCLI(t, "", "diff", "--", filepath.Dir(dir))

		// assert
		assert.Equal(t, 2, code)
		assert.Contains(t, errOut, "is outside the repository")
	})
}

func TestRunDiffOutsideARepository(t *testing.T) {
	// arrange
	t.Chdir(t.TempDir())

	// act
	code, _, errOut := runCLI(t, "", "diff")

	// assert
	assert.Equal(t, 2, code)
	assert.Contains(t, errOut, "not two markdown files and not inside a git repository")
}

func TestResolveRevisions(t *testing.T) {
	tests := []struct {
		name string
		revs []string
		want revRange
	}{
		{name: "nothing", want: revRange{oldRev: "HEAD", oldLabel: "HEAD", newLabel: workingTree}},
		{name: "one", revs: []string{"v1"}, want: revRange{oldRev: "v1", oldLabel: "v1", newLabel: workingTree}},
		{
			name: "two dots", revs: []string{"v1..v2"},
			want: revRange{oldRev: "v1", newRev: "v2", oldLabel: "v1", newLabel: "v2"},
		},
		{
			name: "two dots, one side left out", revs: []string{"v1.."},
			want: revRange{oldRev: "v1", newRev: "HEAD", oldLabel: "v1", newLabel: "HEAD"},
		},
		{
			name: "two", revs: []string{strings.Repeat("ab", 20), "v2"},
			want: revRange{oldRev: strings.Repeat("ab", 20), newRev: "v2", oldLabel: "abababab", newLabel: "v2"},
		},
	}
	repo := &gitRepo{}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got, err := repo.resolve(t.Context(), tc.revs)

			// assert
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}

	t.Run("refuses three revisions and an option", func(t *testing.T) {
		for _, revs := range [][]string{{"a", "b", "c"}, {"--output=x"}} {
			// act
			_, err := repo.resolve(t.Context(), revs)

			// assert
			assert.Error(t, err, "%v", revs)
		}
	})
}

func TestParseNameStatus(t *testing.T) {
	// arrange
	out := []byte("M\x00a.md\x00A\x00b c.md\x00D\x00d.md\x00R087\x00old.md\x00new.md\x00C100\x00src.md\x00copy.md\x00")

	// act
	got, err := parseNameStatus(out)

	// assert
	require.NoError(t, err)
	assert.Equal(t, []sides{
		{status: page.Modified, oldPath: "a.md", newPath: "a.md"},
		{status: page.Added, newPath: "b c.md"},
		{status: page.Deleted, oldPath: "d.md"},
		{status: page.Renamed, oldPath: "old.md", newPath: "new.md"},
		{status: page.Added, newPath: "copy.md"},
	}, got)
}

func TestParseNameStatusTruncated(t *testing.T) {
	for _, out := range []string{"M\x00", "R100\x00old.md\x00"} {
		// act
		_, err := parseNameStatus([]byte(out))

		// assert
		assert.Error(t, err, "%q", out)
	}
}
