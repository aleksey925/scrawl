package history

import (
	"io/fs"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// cleanEnv is what the test's own git calls run with, matching what the service
// gives its subprocesses: nothing the host set can steer them.
func cleanEnv() []string {
	res := []string{}
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, "GIT_") {
			res = append(res, kv)
		}
	}
	return append(res, "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null", "LC_ALL=C")
}

func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()

	cmd := exec.Command("git", append([]string{"--no-pager", "-c", "safe.directory=" + dir}, args...)...)
	cmd.Dir = dir
	cmd.Env = cleanEnv()
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "git %v: %s", args, out)
	return string(out)
}

func gitInit(t *testing.T, dir string) {
	t.Helper()

	runGit(t, dir, "init", "--quiet", "--initial-branch="+initialBranch, ".")
}

// visibleFiles stands in for the store: every file except the dot-entries the
// rest of the app never sees.
func visibleFiles(root string) ([]string, error) {
	res := []string{}
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, relErr := filepath.Rel(root, p)
		if relErr != nil {
			return relErr
		}
		if rel == "." {
			return nil
		}
		if strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if !d.IsDir() {
			res = append(res, filepath.ToSlash(rel))
		}
		return nil
	})
	return res, err
}

func newService(t *testing.T, tune ...func(*Config)) *Service {
	t.Helper()

	return serviceAt(t, t.TempDir(), tune...)
}

func serviceAt(t *testing.T, root string, tune ...func(*Config)) *Service {
	t.Helper()

	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	cfg := Config{Root: root, Files: func() ([]string, error) { return visibleFiles(root) }}
	for _, fn := range tune {
		fn(&cfg)
	}
	s, err := New(cfg)
	require.NoError(t, err)
	t.Cleanup(func() { assert.NoError(t, s.Close()) })
	return s
}

func writeFile(t *testing.T, root, rel, content string) {
	t.Helper()

	full := filepath.Join(root, filepath.FromSlash(rel))
	require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o755))
	require.NoError(t, os.WriteFile(full, []byte(content), 0o644))
}

// writeBoth writes two files without touching testing.T, which is what makes it
// safe inside the goroutines that drive two records into each other.
func writeBoth(root, first, firstContent, second, secondContent string) error {
	if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(first)), []byte(firstContent), 0o644); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(root, filepath.FromSlash(second)), []byte(secondContent), 0o644)
}

func trackedPaths(t *testing.T, s *Service) []string {
	t.Helper()

	return splitNul([]byte(runGit(t, s.Root(), "ls-files", "-z")))
}

func commitPaths(t *testing.T, s *Service, rev string) []string {
	t.Helper()

	res := splitNul([]byte(runGit(t, s.Root(), "show", "--pretty=format:", "--name-only", "-z", rev)))
	for i := range res {
		res[i] = strings.TrimLeft(res[i], "\n")
	}
	slices.Sort(res)
	return res
}

func commitCount(t *testing.T, s *Service) int {
	t.Helper()

	if !s.hasHead(t.Context()) {
		return 0
	}
	count, err := strconv.Atoi(strings.TrimSpace(runGit(t, s.Root(), "rev-list", "--count", "HEAD")))
	require.NoError(t, err)
	return count
}

// lockIndex leaves behind what a crashed git leaves behind. Every later call
// that touches the index fails, which is the cheapest way to make a commit fail
// for real instead of faking one.
func lockIndex(t *testing.T, s *Service) {
	t.Helper()

	require.NoError(t, os.WriteFile(filepath.Join(s.Root(), ".git", "index.lock"), nil, 0o644))
}

func unlockIndex(t *testing.T, s *Service) {
	t.Helper()

	require.NoError(t, os.Remove(filepath.Join(s.Root(), ".git", "index.lock")))
}

// record is the common shape of a test write: put the content there, record it.
func record(t *testing.T, s *Service, op Op, files map[string]string) error {
	t.Helper()

	return s.Record(t.Context(), op, func() ([]string, error) {
		for rel, content := range files {
			writeFile(t, s.Root(), rel, content)
		}
		return nil, nil
	})
}

func TestNew(t *testing.T) {
	t.Run("initializes a repository in an empty root", func(t *testing.T) {
		// act
		s := newService(t)

		// assert
		assert.DirExists(t, filepath.Join(s.Root(), ".git"))
		assert.True(t, s.Enabled())
		assert.False(t, s.Degraded())
		assert.Equal(t, 0, commitCount(t, s))
	})

	t.Run("adopts a repository already rooted at the notes root", func(t *testing.T) {
		// arrange
		root := t.TempDir()
		gitInit(t, root)
		writeFile(t, root, "old.md", "old\n")
		runGit(t, root, "-c", "user.name=someone", "-c", "user.email=someone@example.com", "commit",
			"--quiet", "--allow-empty", "-m", "made earlier")

		// act
		s := serviceAt(t, root)

		// assert
		assert.Equal(t, 1, commitCount(t, s))
		require.NoError(t, record(t, s, Op{Actor: "alex", Paths: []string{"old.md"}}, map[string]string{"old.md": "new\n"}))
		assert.Equal(t, 2, commitCount(t, s))
	})

	t.Run("refuses a root inside another repository", func(t *testing.T) {
		// arrange
		parent := t.TempDir()
		gitInit(t, parent)
		notes := filepath.Join(parent, "notes")
		require.NoError(t, os.MkdirAll(notes, 0o755))

		// act
		s, err := New(Config{Root: notes, Files: func() ([]string, error) { return visibleFiles(notes) }})

		// assert
		require.Error(t, err)
		assert.Nil(t, s)
		assert.ErrorIs(t, err, ErrInsideRepo)
		assert.NoDirExists(t, filepath.Join(notes, ".git"))
	})

	t.Run("refuses a configuration without a root", func(t *testing.T) {
		// act
		_, err := New(Config{Files: func() ([]string, error) { return nil, nil }})

		// assert
		require.Error(t, err)
	})

	t.Run("refuses a configuration without a file list", func(t *testing.T) {
		// act
		_, err := New(Config{Root: t.TempDir()})

		// assert
		require.Error(t, err)
	})

	t.Run("reports a missing git binary", func(t *testing.T) {
		// arrange
		root := t.TempDir()
		t.Setenv("PATH", "")

		// act
		_, err := New(Config{Root: root, Files: func() ([]string, error) { return nil, nil }})

		// assert
		assert.ErrorIs(t, err, ErrNoGit)
	})
}

func TestServiceRecord(t *testing.T) {
	t.Run("commits the mutation under the actor", func(t *testing.T) {
		// arrange
		s := newService(t)

		// act
		err := record(t, s, Op{Actor: "alex", Message: "save note.md", Paths: []string{"note.md"}},
			map[string]string{"note.md": "# note\n"})

		// assert
		require.NoError(t, err)
		assert.False(t, s.Degraded())
		assert.Equal(t, []string{"note.md"}, trackedPaths(t, s))

		entries, err := s.Log(t.Context(), "note.md", 0)
		require.NoError(t, err)
		require.Len(t, entries, 1)
		assert.Equal(t, "alex", entries[0].Actor)
		assert.Equal(t, "save note.md", entries[0].Message)
		assert.Equal(t, "note.md", entries[0].Path)
		assert.Equal(t, KindAdded, entries[0].Kind)

		content, err := s.Show(t.Context(), entries[0].Blob)
		require.NoError(t, err)
		assert.Equal(t, "# note\n", string(content))
		assert.Equal(t, committerName, strings.TrimSpace(runGit(t, s.Root(), "log", "-1", "--format=%cn")))
	})

	t.Run("stages only the paths the operation names", func(t *testing.T) {
		// arrange
		s := newService(t)
		writeFile(t, s.Root(), "untouched.md", "not mine\n")
		writeFile(t, s.Root(), "untouched.txt", "not mine either\n")

		// act
		err := record(t, s, Op{Actor: "alex", Paths: []string{"note.md"}}, map[string]string{"note.md": "# note\n"})

		// assert
		require.NoError(t, err)
		assert.Equal(t, []string{"note.md"}, trackedPaths(t, s))
	})

	t.Run("merges the paths the mutation reports with the ones it was given", func(t *testing.T) {
		// arrange
		s := newService(t)

		// act
		op := Op{Actor: "alex", Message: "upload an attachment", Paths: []string{"note.md"}}
		err := s.Record(t.Context(), op, func() ([]string, error) {
			writeFile(t, s.Root(), "note.md", "# note\n")
			writeFile(t, s.Root(), "note/image-1.png", "png\n")
			return []string{"note/image-1.png", "note/plain.txt", "../outside.png"}, nil
		})

		// assert
		require.NoError(t, err)
		assert.Equal(t, []string{"note.md", "note/image-1.png"}, trackedPaths(t, s))
	})

	t.Run("skips the commit when the mutation changed nothing", func(t *testing.T) {
		// arrange
		s := newService(t)
		require.NoError(t, record(t, s, Op{Actor: "alex", Paths: []string{"note.md"}}, map[string]string{"note.md": "same\n"}))

		// act
		err := record(t, s, Op{Actor: "bob", Paths: []string{"note.md"}}, map[string]string{"note.md": "same\n"})

		// assert
		require.NoError(t, err)
		assert.Equal(t, 1, commitCount(t, s))
		assert.False(t, s.Degraded())
	})

	t.Run("returns the mutation error and records nothing", func(t *testing.T) {
		// arrange
		s := newService(t)
		failure := os.ErrPermission

		// act
		err := s.Record(t.Context(), Op{Actor: "alex", Paths: []string{"note.md"}},
			func() ([]string, error) { return nil, failure })

		// assert
		assert.ErrorIs(t, err, failure)
		assert.Equal(t, 0, commitCount(t, s))
		assert.False(t, s.Degraded())
	})

	t.Run("records a deletion", func(t *testing.T) {
		// arrange
		s := newService(t)
		require.NoError(t, record(t, s, Op{Actor: "alex", Paths: []string{"note.md"}}, map[string]string{"note.md": "# note\n"}))

		// act
		op := Op{Actor: "alex", Message: "delete note.md", Paths: []string{"note.md"}}
		err := s.Record(t.Context(), op, func() ([]string, error) {
			return nil, os.Remove(filepath.Join(s.Root(), "note.md"))
		})

		// assert
		require.NoError(t, err)
		assert.Empty(t, trackedPaths(t, s))

		entries, err := s.Log(t.Context(), "note.md", 0)
		require.NoError(t, err)
		require.Len(t, entries, 2)
		assert.Equal(t, KindDeleted, entries[0].Kind)
		assert.Empty(t, entries[0].Blob)

		content, err := s.Show(t.Context(), entries[1].Blob)
		require.NoError(t, err)
		assert.Equal(t, "# note\n", string(content))
	})

	t.Run("records a rename as one commit", func(t *testing.T) {
		// arrange
		s := newService(t)
		require.NoError(t, record(t, s, Op{Actor: "alex", Paths: []string{"note.md"}}, map[string]string{"note.md": "# note\n"}))

		// act
		op := Op{Actor: "bob", Message: "move note.md", Paths: []string{"note.md", "moved.md"}}
		err := s.Record(t.Context(), op, func() ([]string, error) {
			return nil, os.Rename(filepath.Join(s.Root(), "note.md"), filepath.Join(s.Root(), "moved.md"))
		})

		// assert
		require.NoError(t, err)
		assert.Equal(t, []string{"moved.md"}, trackedPaths(t, s))
		assert.Equal(t, 2, commitCount(t, s))

		entries, err := s.Log(t.Context(), "moved.md", 0)
		require.NoError(t, err)
		require.Len(t, entries, 2)
		assert.Equal(t, KindRenamed, entries[0].Kind)
		assert.Equal(t, "moved.md", entries[0].Path)
		assert.Equal(t, "note.md", entries[1].Path)
	})

	t.Run("records paths git would otherwise read as options or magic", func(t *testing.T) {
		// arrange
		s := newService(t)
		files := map[string]string{
			":colon.md":         "colon\n",
			"-dash.md":          "dash\n",
			"sub dir/b file.md": "spaces\n",
			"юникод/файл.md":    "unicode\n",
		}

		// act
		err := record(t, s, Op{Actor: "alex", Paths: slices.Collect(maps.Keys(files))}, files)

		// assert
		require.NoError(t, err)
		want := slices.Collect(maps.Keys(files))
		slices.Sort(want)
		assert.Equal(t, want, trackedPaths(t, s))

		entries, err := s.Log(t.Context(), ":colon.md", 0)
		require.NoError(t, err)
		require.Len(t, entries, 1)
		assert.Equal(t, ":colon.md", entries[0].Path)
	})

	t.Run("ignores a path whose extension is not versioned", func(t *testing.T) {
		// arrange
		s := newService(t)

		// act
		err := record(t, s, Op{Actor: "alex", Paths: []string{"notes.txt"}}, map[string]string{"notes.txt": "plain\n"})

		// assert
		require.NoError(t, err)
		assert.Equal(t, 0, commitCount(t, s))
	})

	t.Run("versions the configured extensions", func(t *testing.T) {
		// arrange
		s := newService(t, func(c *Config) { c.Extensions = []string{"txt"} })

		// act
		err := record(t, s, Op{Actor: "alex", Paths: []string{"notes.txt", "notes.md"}},
			map[string]string{"notes.txt": "plain\n", "notes.md": "markdown\n"})

		// assert
		require.NoError(t, err)
		assert.Equal(t, []string{"notes.txt"}, trackedPaths(t, s))
	})

	t.Run("refuses a path that escapes the root and never runs the mutation", func(t *testing.T) {
		// arrange
		s := newService(t)
		ran := false

		// act
		err := s.Record(t.Context(), Op{Actor: "alex", Paths: []string{"../evil.md"}}, func() ([]string, error) {
			ran = true
			return nil, nil
		})

		// assert
		assert.ErrorIs(t, err, ErrBadPath)
		assert.False(t, ran)
	})

	t.Run("sanitizes an actor that would break the author line", func(t *testing.T) {
		// arrange
		s := newService(t)

		// act
		err := record(t, s, Op{Actor: "ev<il>\nname", Paths: []string{"note.md"}}, map[string]string{"note.md": "x\n"})

		// assert
		require.NoError(t, err)
		entries, err := s.Log(t.Context(), "note.md", 0)
		require.NoError(t, err)
		require.Len(t, entries, 1)
		assert.Equal(t, "evilname", entries[0].Actor)
	})

	t.Run("names an empty actor", func(t *testing.T) {
		// arrange
		s := newService(t)

		// act
		require.NoError(t, record(t, s, Op{Paths: []string{"note.md"}}, map[string]string{"note.md": "x\n"}))

		// assert
		entries, err := s.Log(t.Context(), "note.md", 0)
		require.NoError(t, err)
		require.Len(t, entries, 1)
		assert.Equal(t, fallbackActor, entries[0].Actor)
	})

	t.Run("fails a strict record when the commit fails", func(t *testing.T) {
		// arrange
		s := newService(t)
		lockIndex(t, s)

		// act
		op := Op{Actor: "token:ci", Message: "save note.md", Paths: []string{"note.md"}, Strict: true}
		err := record(t, s, op, map[string]string{"note.md": "# note\n"})

		// assert
		require.Error(t, err)
		assert.True(t, s.Degraded())
		assert.Equal(t, 0, commitCount(t, s))
		assert.FileExists(t, filepath.Join(s.Root(), "note.md"))
	})

	t.Run("keeps a best effort record and reports the service degraded", func(t *testing.T) {
		// arrange
		s := newService(t)
		lockIndex(t, s)

		// act
		err := record(t, s, Op{Actor: "alex", Paths: []string{"note.md"}}, map[string]string{"note.md": "# note\n"})

		// assert
		require.NoError(t, err)
		assert.True(t, s.Degraded())
		assert.Equal(t, 0, commitCount(t, s))
	})

	t.Run("folds the paths of a failed commit into the next one", func(t *testing.T) {
		// arrange
		s := newService(t)
		lockIndex(t, s)
		require.NoError(t, record(t, s, Op{Actor: "alex", Paths: []string{"missed.md"}}, map[string]string{"missed.md": "missed\n"}))
		require.True(t, s.Degraded())
		unlockIndex(t, s)

		// act
		err := record(t, s, Op{Actor: "bob", Paths: []string{"next.md"}}, map[string]string{"next.md": "next\n"})

		// assert
		require.NoError(t, err)
		assert.False(t, s.Degraded())
		assert.Equal(t, []string{"missed.md", "next.md"}, trackedPaths(t, s))
	})

	t.Run("keeps every record with its own actor and its own paths", func(t *testing.T) {
		// arrange
		s := newService(t)
		require.NoError(t, record(t, s, Op{Actor: "seed", Paths: []string{"shared.md"}}, map[string]string{"shared.md": "seed\n"}))

		firstInside, release := make(chan struct{}), make(chan struct{})
		secondCalled, secondRan := make(chan struct{}), make(chan struct{})
		firstDone, secondDone := make(chan error, 1), make(chan error, 1)

		// act
		go func() {
			op := Op{Actor: "alice", Message: "alice saves", Paths: []string{"shared.md", "alice.md"}}
			firstDone <- s.Record(t.Context(), op, func() ([]string, error) {
				close(firstInside)
				<-release
				return nil, writeBoth(s.Root(), "shared.md", "alice\n", "alice.md", "a\n")
			})
		}()
		<-firstInside

		go func() {
			op := Op{Actor: "bob", Message: "bob saves", Paths: []string{"shared.md", "bob.md"}}
			close(secondCalled)
			secondDone <- s.Record(t.Context(), op, func() ([]string, error) {
				close(secondRan)
				return nil, writeBoth(s.Root(), "shared.md", "bob\n", "bob.md", "b\n")
			})
		}()
		<-secondCalled

		// bob is inside Record now, so the only thing that can hold his mutation
		// back is the lock alice took before running hers
		select {
		case <-secondRan:
			t.Fatal("the second record mutated while the first was still inside its own")
		case <-time.After(100 * time.Millisecond):
		}
		close(release)

		// assert
		require.NoError(t, <-firstDone)
		require.NoError(t, <-secondDone)

		entries, err := s.Log(t.Context(), "shared.md", 0)
		require.NoError(t, err)
		require.Len(t, entries, 3)
		assert.Equal(t, []string{"bob", "alice", "seed"}, []string{entries[0].Actor, entries[1].Actor, entries[2].Actor})

		assert.Equal(t, []string{"bob.md", "shared.md"}, commitPaths(t, s, entries[0].Rev))
		assert.Equal(t, []string{"alice.md", "shared.md"}, commitPaths(t, s, entries[1].Rev))

		bob, err := s.Show(t.Context(), entries[0].Blob)
		require.NoError(t, err)
		assert.Equal(t, "bob\n", string(bob))
		alice, err := s.Show(t.Context(), entries[1].Blob)
		require.NoError(t, err)
		assert.Equal(t, "alice\n", string(alice))
	})

	t.Run("never runs a hook the repository already carries", func(t *testing.T) {
		// arrange
		root := t.TempDir()
		gitInit(t, root)
		marker := filepath.Join(root, "hook-ran")
		writeFile(t, root, ".git/hooks/pre-commit", "#!/bin/sh\ntouch "+marker+"\nexit 1\n")
		require.NoError(t, os.Chmod(filepath.Join(root, ".git", "hooks", "pre-commit"), 0o755))
		s := serviceAt(t, root)

		// act
		err := record(t, s, Op{Actor: "alex", Paths: []string{"note.md"}, Strict: true}, map[string]string{"note.md": "# note\n"})

		// assert
		require.NoError(t, err)
		assert.NoFileExists(t, marker)
		assert.Equal(t, 1, commitCount(t, s))
	})

	t.Run("never runs a filter the repository already carries", func(t *testing.T) {
		// arrange
		root := t.TempDir()
		gitInit(t, root)
		marker := filepath.Join(t.TempDir(), "filter-ran")
		writeFile(t, root, ".gitattributes", "* filter=evil\n")
		// the command is a script rather than an inline one: a semicolon opens a
		// comment in the config syntax, which would leave a command that cannot run
		script := filepath.Join(t.TempDir(), "clean.sh")
		require.NoError(t, os.WriteFile(script, []byte("#!/bin/sh\ntouch "+marker+"\ncat\n"), 0o700))
		config := filepath.Join(root, ".git", "config")
		current, readErr := os.ReadFile(config)
		require.NoError(t, readErr)
		hostile := "[filter \"evil\"]\n\tclean = " + script + "\n"
		require.NoError(t, os.WriteFile(config, append(current, hostile...), 0o600))
		s := serviceAt(t, root)

		// act
		err := record(t, s, Op{Actor: "alex", Paths: []string{"note.md"}, Strict: true}, map[string]string{"note.md": "# note\n"})

		// assert
		require.NoError(t, err)
		assert.NoFileExists(t, marker)
		assert.Equal(t, 1, commitCount(t, s))
	})

	t.Run("never runs a hook from a directory the repository planted for us", func(t *testing.T) {
		// arrange
		root := t.TempDir()
		gitInit(t, root)
		marker := filepath.Join(t.TempDir(), "hook-ran")
		// the path an earlier version pointed core.hooksPath at, standing there
		// before we ever look: a directory of ours inside a repository somebody
		// else assembled was never ours to begin with
		writeFile(t, root, ".git/scrawl-no-hooks/pre-commit", "#!/bin/sh\ntouch "+marker+"\nexit 1\n")
		require.NoError(t, os.Chmod(filepath.Join(root, ".git", "scrawl-no-hooks", "pre-commit"), 0o755))
		s := serviceAt(t, root)

		// act
		err := record(t, s, Op{Actor: "alex", Paths: []string{"note.md"}, Strict: true}, map[string]string{"note.md": "# note\n"})

		// assert
		require.NoError(t, err)
		assert.NoFileExists(t, marker)
		assert.Equal(t, 1, commitCount(t, s))
	})

	t.Run("neutralizes a filter even when the attributes file already mentions the unset", func(t *testing.T) {
		// arrange
		root := t.TempDir()
		gitInit(t, root)
		marker := filepath.Join(t.TempDir(), "filter-ran")
		script := filepath.Join(t.TempDir(), "clean.sh")
		require.NoError(t, os.WriteFile(script, []byte("#!/bin/sh\ntouch "+marker+"\ncat\n"), 0o700))
		writeFile(t, root, ".gitattributes", "* filter=evil\n")
		config := filepath.Join(root, ".git", "config")
		current, readErr := os.ReadFile(config)
		require.NoError(t, readErr)
		hostile := "[filter \"evil\"]\n\tclean = " + script + "\n"
		require.NoError(t, os.WriteFile(config, append(current, hostile...), 0o600))
		// the unset is there only as a comment, with a real assignment after it,
		// and the last matching line is the one git acts on
		writeFile(t, root, ".git/info/attributes", "# "+noFilterAttr+"\n* filter=evil\n")
		s := serviceAt(t, root)

		// act
		err := record(t, s, Op{Actor: "alex", Paths: []string{"note.md"}, Strict: true}, map[string]string{"note.md": "# note\n"})

		// assert
		require.NoError(t, err)
		assert.NoFileExists(t, marker)
	})

	t.Run("never writes its attributes through a symlink the repository planted", func(t *testing.T) {
		// arrange
		root := t.TempDir()
		gitInit(t, root)
		outside := filepath.Join(t.TempDir(), "outside")
		require.NoError(t, os.WriteFile(outside, []byte("original\n"), 0o600))
		require.NoError(t, os.MkdirAll(filepath.Join(root, ".git", "info"), 0o750))
		require.NoError(t, os.Symlink(outside, filepath.Join(root, ".git", "info", "attributes")))

		// act
		serviceAt(t, root)

		// assert
		kept, err := os.ReadFile(outside)
		require.NoError(t, err)
		assert.Equal(t, "original\n", string(kept))
	})

	t.Run("never runs the fsmonitor the repository configures", func(t *testing.T) {
		// arrange
		root := t.TempDir()
		gitInit(t, root)
		marker := filepath.Join(t.TempDir(), "fsmonitor-ran")
		script := filepath.Join(t.TempDir(), "fsmonitor.sh")
		require.NoError(t, os.WriteFile(script, []byte("#!/bin/sh\ntouch "+marker+"\nexit 1\n"), 0o700))
		config := filepath.Join(root, ".git", "config")
		current, readErr := os.ReadFile(config)
		require.NoError(t, readErr)
		hostile := "[core]\n\tfsmonitor = " + script + "\n"
		require.NoError(t, os.WriteFile(config, append(current, hostile...), 0o600))
		s := serviceAt(t, root)

		// act
		err := record(t, s, Op{Actor: "alex", Paths: []string{"note.md"}, Strict: true}, map[string]string{"note.md": "# note\n"})

		// assert
		require.NoError(t, err)
		assert.NoFileExists(t, marker)
		assert.Equal(t, 1, commitCount(t, s))
	})

	t.Run("a disabled service only runs the mutation", func(t *testing.T) {
		// arrange
		var s *Service
		ran := false

		// act
		err := s.Record(t.Context(), Op{Actor: "alex", Paths: []string{"note.md"}}, func() ([]string, error) {
			ran = true
			return nil, nil
		})

		// assert
		require.NoError(t, err)
		assert.True(t, ran)
		assert.False(t, s.Enabled())
		assert.False(t, s.Degraded())
		assert.Empty(t, s.Root())
	})
}

func TestServiceReconcile(t *testing.T) {
	t.Run("imports the baseline", func(t *testing.T) {
		// arrange
		s := newService(t)
		writeFile(t, s.Root(), "one.md", "one\n")
		writeFile(t, s.Root(), "sub/two.md", "two\n")
		writeFile(t, s.Root(), "notes.txt", "plain\n")
		writeFile(t, s.Root(), ".hidden/secret.md", "secret\n")

		// act
		err := s.Reconcile(t.Context(), "scrawl")

		// assert
		require.NoError(t, err)
		assert.Equal(t, []string{"one.md", "sub/two.md"}, trackedPaths(t, s))

		entries, err := s.Log(t.Context(), "one.md", 0)
		require.NoError(t, err)
		require.Len(t, entries, 1)
		assert.Equal(t, baselineMessage, entries[0].Message)
		assert.Equal(t, "scrawl", entries[0].Actor)
	})

	t.Run("commits nothing when everything is already recorded", func(t *testing.T) {
		// arrange
		s := newService(t)
		writeFile(t, s.Root(), "one.md", "one\n")
		require.NoError(t, s.Reconcile(t.Context(), "scrawl"))

		// act
		err := s.Reconcile(t.Context(), "scrawl")

		// assert
		require.NoError(t, err)
		assert.Equal(t, 1, commitCount(t, s))
	})

	t.Run("records a change made outside the app", func(t *testing.T) {
		// arrange
		s := newService(t)
		writeFile(t, s.Root(), "one.md", "one\n")
		require.NoError(t, s.Reconcile(t.Context(), "scrawl"))
		writeFile(t, s.Root(), "one.md", "changed by somebody else\n")

		// act
		err := s.Reconcile(t.Context(), "external")

		// assert
		require.NoError(t, err)
		entries, err := s.Log(t.Context(), "one.md", 0)
		require.NoError(t, err)
		require.Len(t, entries, 2)
		assert.Equal(t, "external", entries[0].Actor)
		assert.Equal(t, reconcileMessage, entries[0].Message)
		assert.Equal(t, KindModified, entries[0].Kind)
	})

	t.Run("records a file deleted outside the app", func(t *testing.T) {
		// arrange
		s := newService(t)
		writeFile(t, s.Root(), "one.md", "one\n")
		writeFile(t, s.Root(), "two.md", "two\n")
		require.NoError(t, s.Reconcile(t.Context(), "scrawl"))
		require.NoError(t, os.Remove(filepath.Join(s.Root(), "one.md")))

		// act
		err := s.Reconcile(t.Context(), "external")

		// assert
		require.NoError(t, err)
		assert.Equal(t, []string{"two.md"}, trackedPaths(t, s))

		entries, err := s.Log(t.Context(), "one.md", 0)
		require.NoError(t, err)
		require.Len(t, entries, 2)
		assert.Equal(t, KindDeleted, entries[0].Kind)
	})

	t.Run("leaves a tracked file the store stopped reporting but still holds", func(t *testing.T) {
		// arrange
		root := t.TempDir()
		reported := true
		s := serviceAt(t, root, func(c *Config) {
			c.Files = func() ([]string, error) {
				all, err := visibleFiles(root)
				if err != nil || reported {
					return all, err
				}
				return slices.DeleteFunc(all, func(p string) bool { return p == "one.md" }), nil
			}
		})
		writeFile(t, root, "one.md", "one\n")
		require.NoError(t, s.Reconcile(t.Context(), "scrawl"))

		// act
		reported = false
		err := s.Reconcile(t.Context(), "external")

		// assert
		require.NoError(t, err)
		assert.Equal(t, []string{"one.md"}, trackedPaths(t, s))
		assert.Equal(t, 1, commitCount(t, s))
	})

	t.Run("reports a failed reconcile", func(t *testing.T) {
		// arrange
		s := newService(t)
		writeFile(t, s.Root(), "one.md", "one\n")
		lockIndex(t, s)

		// act
		err := s.Reconcile(t.Context(), "scrawl")

		// assert
		require.Error(t, err)
		assert.True(t, s.Degraded())
	})

	t.Run("a disabled service does nothing", func(t *testing.T) {
		// arrange
		var s *Service

		// act & assert
		require.NoError(t, s.Reconcile(t.Context(), "scrawl"))
	})
}

func TestServiceLog(t *testing.T) {
	t.Run("is empty on an unborn HEAD", func(t *testing.T) {
		// arrange
		s := newService(t)

		// act
		entries, err := s.Log(t.Context(), "note.md", 0)

		// assert
		require.NoError(t, err)
		assert.Empty(t, entries)
	})

	t.Run("is empty for a path history never held", func(t *testing.T) {
		// arrange
		s := newService(t)
		require.NoError(t, record(t, s, Op{Actor: "alex", Paths: []string{"note.md"}}, map[string]string{"note.md": "x\n"}))

		// act
		entries, err := s.Log(t.Context(), "other.md", 0)

		// assert
		require.NoError(t, err)
		assert.Empty(t, entries)
	})

	t.Run("honors the limit", func(t *testing.T) {
		// arrange
		s := newService(t)
		for _, content := range []string{"one\n", "two\n", "three\n"} {
			require.NoError(t, record(t, s, Op{Actor: "alex", Paths: []string{"note.md"}}, map[string]string{"note.md": content}))
		}

		// act
		entries, err := s.Log(t.Context(), "note.md", 2)

		// assert
		require.NoError(t, err)
		assert.Len(t, entries, 2)
	})

	t.Run("carries the revision, the time and the short hash", func(t *testing.T) {
		// arrange
		s := newService(t)
		before := time.Now().Add(-time.Minute)
		require.NoError(t, record(t, s, Op{Actor: "alex", Paths: []string{"note.md"}}, map[string]string{"note.md": "x\n"}))

		// act
		entries, err := s.Log(t.Context(), "note.md", 0)

		// assert
		require.NoError(t, err)
		require.Len(t, entries, 1)
		assert.Equal(t, strings.TrimSpace(runGit(t, s.Root(), "rev-parse", "HEAD")), entries[0].Rev)
		assert.True(t, strings.HasPrefix(entries[0].Rev, entries[0].Short))
		assert.Less(t, len(entries[0].Short), len(entries[0].Rev),
			"--no-abbrev applies to %h too, so a short hash taken from git is the full one")
		assert.WithinRange(t, entries[0].At, before, time.Now().Add(time.Minute))
	})

	t.Run("refuses a path that escapes the root", func(t *testing.T) {
		// arrange
		s := newService(t)

		// act
		_, err := s.Log(t.Context(), "../outside.md", 0)

		// assert
		assert.ErrorIs(t, err, ErrBadPath)
	})

	t.Run("a disabled service reports it", func(t *testing.T) {
		// arrange
		var s *Service

		// act
		_, err := s.Log(t.Context(), "note.md", 0)

		// assert
		assert.ErrorIs(t, err, ErrDisabled)
	})
}

func TestServiceVersion(t *testing.T) {
	t.Run("resolves the blob the commit recorded for the path", func(t *testing.T) {
		// arrange
		s := newService(t)
		require.NoError(t, record(t, s, Op{Actor: "alex", Paths: []string{"a.md"}}, map[string]string{"a.md": "first\n"}))
		rev := strings.TrimSpace(runGit(t, s.Root(), "rev-parse", "HEAD"))

		// act
		blob, err := s.Version(t.Context(), rev, "a.md")

		// assert
		require.NoError(t, err)
		content, showErr := s.Show(t.Context(), blob)
		require.NoError(t, showErr)
		assert.Equal(t, "first\n", string(content))
	})

	t.Run("refuses a commit that never touched the path", func(t *testing.T) {
		// arrange
		s := newService(t)
		require.NoError(t, record(t, s, Op{Actor: "alex", Paths: []string{"a.md"}}, map[string]string{"a.md": "first\n"}))
		require.NoError(t, record(t, s, Op{Actor: "alex", Paths: []string{"b.md"}}, map[string]string{"b.md": "other\n"}))
		// log walks backwards, so this pair answers with the older commit
		// unless the revision that was asked for is the one that comes back
		latest := strings.TrimSpace(runGit(t, s.Root(), "rev-parse", "HEAD"))

		// act
		_, err := s.Version(t.Context(), latest, "a.md")

		// assert
		require.ErrorIs(t, err, ErrNoVersion)
	})

	t.Run("reads the version from before a rename under its historical path", func(t *testing.T) {
		// arrange
		s := newService(t)
		require.NoError(t, record(t, s, Op{Actor: "alex", Paths: []string{"old.md"}}, map[string]string{"old.md": "before\n"}))
		before := strings.TrimSpace(runGit(t, s.Root(), "rev-parse", "HEAD"))
		require.NoError(t, s.Record(t.Context(), Op{Actor: "alex", Paths: []string{"old.md", "new.md"}}, func() ([]string, error) {
			return nil, os.Rename(filepath.Join(s.Root(), "old.md"), filepath.Join(s.Root(), "new.md"))
		}))

		// act
		blob, err := s.Version(t.Context(), before, "old.md")

		// assert
		require.NoError(t, err)
		content, showErr := s.Show(t.Context(), blob)
		require.NoError(t, showErr)
		assert.Equal(t, "before\n", string(content))
	})

	t.Run("resolves a deletion to no content", func(t *testing.T) {
		// arrange
		s := newService(t)
		require.NoError(t, record(t, s, Op{Actor: "alex", Paths: []string{"a.md"}}, map[string]string{"a.md": "first\n"}))
		require.NoError(t, s.Record(t.Context(), Op{Actor: "alex", Paths: []string{"a.md"}}, func() ([]string, error) {
			return nil, os.Remove(filepath.Join(s.Root(), "a.md"))
		}))
		rev := strings.TrimSpace(runGit(t, s.Root(), "rev-parse", "HEAD"))

		// act
		blob, err := s.Version(t.Context(), rev, "a.md")

		// assert
		require.NoError(t, err)
		assert.Empty(t, blob)
	})

	t.Run("refuses anything that is not an object id", func(t *testing.T) {
		// act
		_, err := newService(t).Version(t.Context(), "HEAD", "a.md")

		// assert
		require.Error(t, err)
	})

	t.Run("a disabled service reports it", func(t *testing.T) {
		// arrange
		var s *Service

		// act
		_, err := s.Version(t.Context(), strings.Repeat("a1b2c3d4", 5), "a.md")

		// assert
		require.ErrorIs(t, err, ErrDisabled)
	})
}

func TestServiceShow(t *testing.T) {
	t.Run("reads the version from before a rename", func(t *testing.T) {
		// arrange
		s := newService(t)
		require.NoError(t, record(t, s, Op{Actor: "alex", Paths: []string{"note.md"}}, map[string]string{"note.md": "first\n"}))
		op := Op{Actor: "alex", Paths: []string{"note.md", "moved.md"}}
		require.NoError(t, s.Record(t.Context(), op, func() ([]string, error) {
			return nil, os.Rename(filepath.Join(s.Root(), "note.md"), filepath.Join(s.Root(), "moved.md"))
		}))
		require.NoError(t, record(t, s, Op{Actor: "alex", Paths: []string{"moved.md"}}, map[string]string{"moved.md": "second\n"}))

		entries, err := s.Log(t.Context(), "moved.md", 0)
		require.NoError(t, err)
		require.Len(t, entries, 3)

		// act
		oldest, err := s.Show(t.Context(), entries[2].Blob)

		// assert
		require.NoError(t, err)
		assert.Equal(t, "first\n", string(oldest))
		assert.Equal(t, "note.md", entries[2].Path)
	})

	t.Run("refuses anything that is not an object id", func(t *testing.T) {
		// arrange
		s := newService(t)

		// act & assert
		for _, blob := range []string{"", "HEAD", "HEAD:note.md", "--help", strings.Repeat("z", 40)} {
			_, err := s.Show(t.Context(), blob)
			assert.Error(t, err, "blob %q", blob)
		}
	})

	t.Run("a disabled service reports it", func(t *testing.T) {
		// arrange
		var s *Service

		// act
		_, err := s.Show(t.Context(), strings.Repeat("a", 40))

		// assert
		assert.ErrorIs(t, err, ErrDisabled)
	})
}

func TestServiceDiff(t *testing.T) {
	t.Run("diffs the first commit, which has no parent", func(t *testing.T) {
		// arrange
		s := newService(t)
		require.NoError(t, record(t, s, Op{Actor: "alex", Paths: []string{"note.md"}}, map[string]string{"note.md": "first\n"}))
		entries, err := s.Log(t.Context(), "note.md", 0)
		require.NoError(t, err)

		// act
		diff, err := s.Diff(t.Context(), entries[0].Rev, entries[0].Path)

		// assert
		require.NoError(t, err)
		assert.True(t, strings.HasPrefix(diff, "diff --git "), "got %q", diff)
		assert.Contains(t, diff, "+first")
		assert.Contains(t, diff, "new file mode")
	})

	t.Run("diffs a later commit against its parent", func(t *testing.T) {
		// arrange
		s := newService(t)
		require.NoError(t, record(t, s, Op{Actor: "alex", Paths: []string{"note.md"}}, map[string]string{"note.md": "first\n"}))
		require.NoError(t, record(t, s, Op{Actor: "bob", Paths: []string{"note.md"}}, map[string]string{"note.md": "second\n"}))
		entries, err := s.Log(t.Context(), "note.md", 0)
		require.NoError(t, err)

		// act
		diff, err := s.Diff(t.Context(), entries[0].Rev, entries[0].Path)

		// assert
		require.NoError(t, err)
		assert.Contains(t, diff, "-first")
		assert.Contains(t, diff, "+second")
	})

	t.Run("refuses anything that is not an object id", func(t *testing.T) {
		// arrange
		s := newService(t)

		// act
		_, err := s.Diff(t.Context(), "HEAD", "note.md")

		// assert
		require.Error(t, err)
	})

	t.Run("a disabled service reports it", func(t *testing.T) {
		// arrange
		var s *Service

		// act
		_, err := s.Diff(t.Context(), strings.Repeat("a", 40), "note.md")

		// assert
		assert.ErrorIs(t, err, ErrDisabled)
	})
}

func TestCleanPath(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "plain path", in: "note.md", want: "note.md"},
		{name: "nested path", in: "sub/note.md", want: "sub/note.md"},
		{name: "current directory prefix", in: "./note.md", want: "note.md"},
		{name: "inner traversal", in: "sub/../note.md", want: "note.md"},
		{name: "leading colon", in: ":note.md", want: ":note.md"},
		{name: "leading dash", in: "-note.md", want: "-note.md"},
		{name: "empty", in: ""},
		{name: "root", in: "."},
		{name: "absolute", in: "/etc/passwd"},
		{name: "escaping", in: "../outside.md"},
		{name: "git directory", in: ".git/config"},
		{name: "nul byte", in: "note\x00.md"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			got, err := cleanPath(tc.in)

			// assert
			if tc.want == "" {
				assert.ErrorIs(t, err, ErrBadPath)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestIdent(t *testing.T) {
	tests := []struct {
		name  string
		actor string
		want  string
	}{
		{name: "plain", actor: "alex", want: "alex <alex@" + actorDomain + ">"},
		{name: "token", actor: "token:ci", want: "token:ci <token:ci@" + actorDomain + ">"},
		{name: "two words", actor: "Alex P", want: "Alex P <Alex-P@" + actorDomain + ">"},
		{name: "angle brackets", actor: "ev<il>", want: "evil <evil@" + actorDomain + ">"},
		{name: "newline", actor: "alex\nbob", want: "alexbob <alexbob@" + actorDomain + ">"},
		{name: "empty", actor: "", want: fallbackActor + " <" + fallbackActor + "@" + actorDomain + ">"},
		{name: "only spaces", actor: "   ", want: fallbackActor + " <" + fallbackActor + "@" + actorDomain + ">"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act & assert
			assert.Equal(t, tc.want, ident(tc.actor))
		})
	}
}
