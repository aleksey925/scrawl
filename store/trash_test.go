package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStoreDiscard(t *testing.T) {
	tests := []struct {
		name      string
		path      string
		recursive bool
		kept      string
		err       error
	}{
		{name: "file", path: "guide.md", kept: "guide.md"},
		{name: "empty directory", path: "empty", kept: "empty"},
		{name: "non-empty directory without recursive", path: "notes", err: ErrNotEmpty},
		{name: "directory with files, a hidden one among them", path: "notes", recursive: true, kept: "notes/.hidden.md"},
		{name: "missing", path: "nope.md", err: ErrNotFound},
		{name: "ignored", path: ".git", recursive: true, err: ErrNotFound},
		{name: "the root itself", path: "", recursive: true, err: ErrForbidden},
		{name: "outside the root", path: "../" + secretName, err: ErrForbidden},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			files := notesFiles()
			files["empty/"] = ""
			s := newStore(t, files)

			// act
			id, err := s.Discard(tc.path, tc.recursive)

			// assert
			if tc.err != nil {
				require.ErrorIs(t, err, tc.err)
				assert.FileExists(t, filepath.Join(s.Dir(), ".git", "config"))
				assert.FileExists(t, filepath.Join(filepath.Dir(s.Dir()), secretName))
				return
			}
			require.NoError(t, err)
			assert.False(t, s.Exists(tc.path))
			_, err = os.Lstat(filepath.Join(s.Dir(), trashDir, id, filepath.FromSlash(tc.kept)))
			require.NoError(t, err)
		})
	}

	t.Run("the trash is not in the tree", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())

		// act
		_, err := s.Discard("guide.md", false)

		// assert
		require.NoError(t, err)
		tree, err := s.Tree()
		require.NoError(t, err)
		assert.NotContains(t, flatten(tree), trashDir)
	})

	t.Run("a read-only store keeps the directory", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles(), func(cfg *Config) { cfg.ReadOnly = true })

		// act
		_, err := s.Discard("notes", true)

		// assert
		require.ErrorIs(t, err, ErrReadOnly)
		assert.DirExists(t, filepath.Join(s.Dir(), "notes"))
	})
}

func TestStoreRecover(t *testing.T) {
	t.Run("a file comes back where it was", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		id, err := s.Discard("guide.md", false)
		require.NoError(t, err)

		// act
		p, err := s.Recover(id)

		// assert
		require.NoError(t, err)
		assert.Equal(t, "guide.md", p)
		body, err := os.ReadFile(filepath.Join(s.Dir(), "guide.md"))
		require.NoError(t, err)
		assert.Equal(t, notesFiles()["guide.md"], string(body))
		assert.NoDirExists(t, filepath.Join(s.Dir(), trashDir))
	})

	t.Run("another entry stays in the trash when one comes back", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		first, err := s.Discard("guide.md", false)
		require.NoError(t, err)
		second, err := s.Discard("snippet.py", false)
		require.NoError(t, err)

		// act
		_, err = s.Recover(first)

		// assert
		require.NoError(t, err)
		assert.NoDirExists(t, filepath.Join(s.Dir(), trashDir, first))
		assert.FileExists(t, filepath.Join(s.Dir(), trashDir, second, "snippet.py"))
	})

	t.Run("a folder comes back with its hidden files", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		id, err := s.Discard("notes", true)
		require.NoError(t, err)

		// act
		_, err = s.Recover(id)

		// assert
		require.NoError(t, err)
		assert.FileExists(t, filepath.Join(s.Dir(), "notes", ".hidden.md"))
		assert.FileExists(t, filepath.Join(s.Dir(), "notes", "deep", "nested.md"))
	})

	t.Run("a folder gone since is made again", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		id, err := s.Discard("notes/deep/nested.md", false)
		require.NoError(t, err)
		require.NoError(t, os.RemoveAll(filepath.Join(s.Dir(), "notes", "deep")))

		// act
		p, err := s.Recover(id)

		// assert
		require.NoError(t, err)
		assert.FileExists(t, filepath.Join(s.Dir(), filepath.FromSlash(p)))
	})

	t.Run("something now at the place is not overwritten, and the trash keeps the entry", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		id, err := s.Discard("guide.md", false)
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(filepath.Join(s.Dir(), "guide.md"), []byte("# new\n"), 0o644))

		// act
		_, err = s.Recover(id)

		// assert
		require.ErrorIs(t, err, ErrExists)
		body, err := os.ReadFile(filepath.Join(s.Dir(), "guide.md"))
		require.NoError(t, err)
		assert.Equal(t, "# new\n", string(body))
		assert.FileExists(t, filepath.Join(s.Dir(), trashDir, id, "guide.md"))
	})

	t.Run("an id the trash does not hold", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())

		// act
		_, err := s.Recover("../guide.md")

		// assert
		require.ErrorIs(t, err, ErrNotFound)
	})
}

func TestStoreSweepTrash(t *testing.T) {
	t.Run("an entry younger than the keep stays", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		id, err := s.Discard("guide.md", false)
		require.NoError(t, err)

		// act
		s.SweepTrash(time.Now().Add(TrashKeep / 2))

		// assert
		_, err = s.Recover(id)
		require.NoError(t, err)
	})

	t.Run("an entry kept long enough is gone for good", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		id, err := s.Discard("notes", true)
		require.NoError(t, err)

		// act
		s.SweepTrash(time.Now().Add(TrashKeep))

		// assert
		_, err = s.Recover(id)
		require.ErrorIs(t, err, ErrNotFound)
		assert.NoDirExists(t, filepath.Join(s.Dir(), trashDir))
	})
}

func TestStoreEmptiesTheTrashOfAPastRun(t *testing.T) {
	// arrange
	files := notesFiles()
	files[trashDir+"/LEFT/old.md"] = "# old\n"

	// act
	s := newStore(t, files)

	// assert
	assert.NoDirExists(t, filepath.Join(s.Dir(), trashDir))
}
