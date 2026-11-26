package search

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIndexSetDelete(t *testing.T) {
	t.Run("replace keeps one document", func(t *testing.T) {
		// arrange
		ix := New()
		ix.Set("a.md", []byte("Альфа\n=====\n\nальфа текст\n"))

		// act
		ix.Set("a.md", []byte("Бета\n====\n\nбета текст\n"))

		// assert
		assert.Equal(t, 1, ix.Len())
		assert.Empty(t, fuzzyFind(t, ix, "альфа", 10).Results)
		assert.Equal(t, []string{"a.md"}, paths(fuzzyFind(t, ix, "бета", 10)))
	})

	t.Run("delete drops the document", func(t *testing.T) {
		// arrange
		ix := loadNotes(t)
		before := ix.Len()

		// act
		ix.Delete("notes/бэкап.md")
		ix.Delete("notes/бэкап.md")
		ix.Delete("нет-такого.md")

		// assert
		assert.Equal(t, before-1, ix.Len())
		assert.Equal(t, []string{"index.md", "notes/unicode.md"}, paths(fuzzyFind(t, ix, "резервное копирование", 10)))
	})

	t.Run("size follows the content", func(t *testing.T) {
		// arrange
		ix := loadNotes(t)
		require.Positive(t, ix.Size())

		// act
		for _, p := range notesPaths(t) {
			ix.Delete(p)
		}

		// assert
		assert.Equal(t, 0, ix.Len())
		assert.Equal(t, int64(0), ix.Size())
	})
}

func TestIndexConcurrentAccess(t *testing.T) {
	// arrange
	ix := loadNotes(t)
	paths := notesPaths(t)
	content := []byte("Общее\n=====\n\nмониторинг сети и резервное копирование\n")

	// act
	var wg sync.WaitGroup
	for w := range 8 {
		wg.Go(func() {
			for i := range 100 {
				switch (w + i) % 4 {
				case 0:
					ix.Set(fmt.Sprintf("tmp/doc%d.md", w), content)
				case 1:
					ix.Delete(fmt.Sprintf("tmp/doc%d.md", w))
				case 2:
					ix.Set(paths[i%len(paths)], content)
				default:
					_, _ = ix.Find(context.Background(), Query{Text: "мониторинг сети", Mode: ModeFuzzy}, 5)
					_, _ = ix.Find(context.Background(), Query{Text: "монитор", Mode: ModeExact}, 5)
					_, _ = ix.Find(context.Background(), Query{Text: `"резервное копирование"`, Mode: ModeFuzzy}, 5)
					ix.Len()
					ix.Size()
				}
			}
		})
	}
	wg.Wait()

	// assert
	assert.NotEmpty(t, fuzzyFind(t, ix, "мониторинг", 5).Results)
}

func BenchmarkSet(b *testing.B) {
	content, err := os.ReadFile(filepath.Join("testdata", "notes", "docker", "setup.md"))
	require.NoError(b, err)
	content = []byte(strings.Repeat(string(content), 40))
	b.SetBytes(int64(len(content)))

	ix := New()
	for b.Loop() {
		ix.Set("bench/doc.md", content)
	}
}

func loadNotes(tb testing.TB) *Index {
	tb.Helper()

	ix := New()
	for _, p := range notesPaths(tb) {
		data, err := os.ReadFile(filepath.Join("testdata", "notes", filepath.FromSlash(p)))
		require.NoError(tb, err)
		ix.Set(p, data)
	}
	return ix
}

func notesPaths(tb testing.TB) []string {
	tb.Helper()

	root := filepath.Join("testdata", "notes")
	res := []string{}
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".md") {
			return err
		}
		rel, relErr := filepath.Rel(root, p)
		if relErr != nil {
			return relErr
		}
		res = append(res, filepath.ToSlash(rel))
		return nil
	})
	require.NoError(tb, err)
	require.NotEmpty(tb, res)
	return res
}

func indexOf(docs map[string]string) *Index {
	ix := New()
	for p, content := range docs {
		ix.Set(p, []byte(content))
	}
	return ix
}
