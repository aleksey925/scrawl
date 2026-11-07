package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStoreTrash(t *testing.T) {
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
			id, err := s.Trash(tc.path, tc.recursive)

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
		_, err := s.Trash("guide.md", false)

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
		_, err := s.Trash("notes", true)

		// assert
		require.ErrorIs(t, err, ErrReadOnly)
		assert.DirExists(t, filepath.Join(s.Dir(), "notes"))
	})
}

func TestStoreTrashed(t *testing.T) {
	t.Run("names the path an id took", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		id, err := s.Trash("notes/deep/nested.md", false)
		require.NoError(t, err)

		// act
		p, ok := s.Trashed(id)

		// assert
		assert.True(t, ok)
		assert.Equal(t, "notes/deep/nested.md", p)
	})

	t.Run("knows no id it never gave", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())

		// act
		_, ok := s.Trashed("NOPE")

		// assert
		assert.False(t, ok)
	})
}

func TestStoreRestore(t *testing.T) {
	t.Run("a file comes back where it was", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		id, err := s.Trash("guide.md", false)
		require.NoError(t, err)

		// act
		err = s.Restore(id)

		// assert
		require.NoError(t, err)
		body, err := os.ReadFile(filepath.Join(s.Dir(), "guide.md"))
		require.NoError(t, err)
		assert.Equal(t, notesFiles()["guide.md"], string(body))
		assert.NoDirExists(t, filepath.Join(s.Dir(), trashDir))
	})

	t.Run("another entry stays in the trash when one comes back", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		first, err := s.Trash("guide.md", false)
		require.NoError(t, err)
		second, err := s.Trash("snippet.py", false)
		require.NoError(t, err)

		// act
		err = s.Restore(first)

		// assert
		require.NoError(t, err)
		assert.NoDirExists(t, filepath.Join(s.Dir(), trashDir, first))
		require.NoError(t, s.Restore(second))
		assert.FileExists(t, filepath.Join(s.Dir(), "snippet.py"))
		assert.NoDirExists(t, filepath.Join(s.Dir(), trashDir))
	})

	t.Run("a folder comes back with its hidden files", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		id, err := s.Trash("notes", true)
		require.NoError(t, err)

		// act
		err = s.Restore(id)

		// assert
		require.NoError(t, err)
		assert.FileExists(t, filepath.Join(s.Dir(), "notes", ".hidden.md"))
		assert.FileExists(t, filepath.Join(s.Dir(), "notes", "deep", "nested.md"))
	})

	t.Run("a folder gone since is made again", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		id, err := s.Trash("notes/deep/nested.md", false)
		require.NoError(t, err)
		require.NoError(t, os.RemoveAll(filepath.Join(s.Dir(), "notes", "deep")))

		// act
		err = s.Restore(id)

		// assert
		require.NoError(t, err)
		assert.FileExists(t, filepath.Join(s.Dir(), "notes", "deep", "nested.md"))
	})

	t.Run("something now at the place is not overwritten, and the trash keeps the entry", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		id, err := s.Trash("guide.md", false)
		require.NoError(t, err)
		blocker := filepath.Join(s.Dir(), "guide.md")
		require.NoError(t, os.WriteFile(blocker, []byte("# new\n"), 0o644))

		// act
		err = s.Restore(id)

		// assert
		require.ErrorIs(t, err, ErrExists)
		body, err := os.ReadFile(blocker)
		require.NoError(t, err)
		assert.Equal(t, "# new\n", string(body))
		require.NoError(t, os.Remove(blocker))
		require.NoError(t, s.Restore(id))
		body, err = os.ReadFile(blocker)
		require.NoError(t, err)
		assert.Equal(t, notesFiles()["guide.md"], string(body))
	})

	t.Run("a symlink inside comes back and what it points at is untouched", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		secret := filepath.Join(filepath.Dir(s.Dir()), secretName)
		require.NoError(t, os.Symlink(secret, filepath.Join(s.Dir(), "notes", "link")))
		id, err := s.Trash("notes", true)
		require.NoError(t, err)

		// act
		err = s.Restore(id)

		// assert
		require.NoError(t, err)
		target, err := os.Readlink(filepath.Join(s.Dir(), "notes", "link"))
		require.NoError(t, err)
		assert.Equal(t, secret, target)
		body, err := os.ReadFile(secret)
		require.NoError(t, err)
		assert.Equal(t, secretBody, string(body))
	})

	t.Run("a folder above that became a symlink is not followed", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		id, err := s.Trash("notes/index.md", false)
		require.NoError(t, err)
		require.NoError(t, os.RemoveAll(filepath.Join(s.Dir(), "notes")))
		require.NoError(t, os.Mkdir(filepath.Join(s.Dir(), ".private"), 0o750))
		require.NoError(t, os.Symlink(".private", filepath.Join(s.Dir(), "notes")))

		// act
		err = s.Restore(id)

		// assert
		require.ErrorIs(t, err, ErrNotFound)
		assert.NoFileExists(t, filepath.Join(s.Dir(), ".private", "index.md"))
		_, ok := s.Trashed(id)
		assert.True(t, ok)
	})

	t.Run("an id the trash does not hold", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())

		// act
		err := s.Restore("../guide.md")

		// assert
		require.ErrorIs(t, err, ErrNotFound)
	})
}

func TestStoreSweepTrash(t *testing.T) {
	t.Run("an entry younger than the keep stays", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		id, err := s.Trash("guide.md", false)
		require.NoError(t, err)

		// act
		s.SweepTrash(time.Now().Add(trashKeep / 2))

		// assert
		require.NoError(t, s.Restore(id))
	})

	t.Run("an entry kept long enough is gone for good", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		id, err := s.Trash("notes", true)
		require.NoError(t, err)

		// act
		s.SweepTrash(time.Now().Add(trashKeep))

		// assert
		require.ErrorIs(t, s.Restore(id), ErrNotFound)
		assert.NoDirExists(t, filepath.Join(s.Dir(), trashDir))
	})

	t.Run("only the old entry goes when a young one is beside it", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		old, err := s.Trash("guide.md", false)
		require.NoError(t, err)
		young, err := s.Trash("snippet.py", false)
		require.NoError(t, err)
		s.trash[old] = trashed{path: "guide.md", at: time.Now().Add(-trashKeep)}

		// act
		s.SweepTrash(time.Now())

		// assert
		require.ErrorIs(t, s.Restore(old), ErrNotFound)
		assert.NoDirExists(t, filepath.Join(s.Dir(), trashDir, old))
		require.NoError(t, s.Restore(young))
		assert.FileExists(t, filepath.Join(s.Dir(), "snippet.py"))
	})

	t.Run("a symlink inside goes and what it points at stays", func(t *testing.T) {
		// arrange
		s := newStore(t, notesFiles())
		secret := filepath.Join(filepath.Dir(s.Dir()), secretName)
		require.NoError(t, os.Symlink(secret, filepath.Join(s.Dir(), "notes", "link")))
		_, err := s.Trash("notes", true)
		require.NoError(t, err)

		// act
		s.SweepTrash(time.Now().Add(trashKeep))

		// assert
		assert.NoDirExists(t, filepath.Join(s.Dir(), trashDir))
		body, err := os.ReadFile(secret)
		require.NoError(t, err)
		assert.Equal(t, secretBody, string(body))
	})

	t.Run("a read-only store sweeps nothing", func(t *testing.T) {
		// arrange
		files := notesFiles()
		files[trashDir+"/KEPT/old.md"] = "# old\n"
		s := newStore(t, files, func(cfg *Config) { cfg.ReadOnly = true })
		s.trash["KEPT"] = trashed{path: "old.md", at: time.Now().Add(-trashKeep)}

		// act
		s.SweepTrash(time.Now())

		// assert
		assert.FileExists(t, filepath.Join(s.Dir(), trashDir, "KEPT", "old.md"))
	})
}

func TestStoreEmptiesTheTrashOfAPastRun(t *testing.T) {
	t.Run("a writable store empties it", func(t *testing.T) {
		// arrange
		files := notesFiles()
		files[trashDir+"/LEFT/old.md"] = "# old\n"

		// act
		s := newStore(t, files)

		// assert
		assert.NoDirExists(t, filepath.Join(s.Dir(), trashDir))
	})

	t.Run("a read-only store keeps it", func(t *testing.T) {
		// arrange
		files := notesFiles()
		files[trashDir+"/LEFT/old.md"] = "# old\n"

		// act
		s := newStore(t, files, func(cfg *Config) { cfg.ReadOnly = true })

		// assert
		assert.FileExists(t, filepath.Join(s.Dir(), trashDir, "LEFT", "old.md"))
	})
}
