package render

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var update = flag.Bool("update", false, "rewrite the golden files")

func TestRenderGolden(t *testing.T) {
	sources, err := filepath.Glob(filepath.Join("testdata", "md", "*.md"))
	require.NoError(t, err)
	require.NotEmpty(t, sources)

	r := New(Options{})
	for _, src := range sources {
		name := filepath.Base(src)
		t.Run(name, func(t *testing.T) {
			// arrange
			data, err := os.ReadFile(src)
			require.NoError(t, err)

			// act
			res, err := r.Render(data, "docs/"+name)
			require.NoError(t, err)

			// assert
			assert.Equal(t, golden(t, name, format(res)), format(res))
		})
	}
}

// format lays a Result out as one diffable text block.
func format(res Result) string {
	var b strings.Builder
	fmt.Fprintf(&b, "title: %s\ntoc:\n", res.Title)
	for _, h := range res.TOC {
		fmt.Fprintf(&b, "  h%d #%s %s\n", h.Level, h.ID, h.Text)
	}
	b.WriteString("---\n")
	b.WriteString(string(res.HTML))
	return b.String()
}

func golden(t *testing.T, name, got string) string {
	t.Helper()
	p := filepath.Join("testdata", "golden", strings.TrimSuffix(name, ".md")+".txt")
	if *update {
		require.NoError(t, os.WriteFile(p, []byte(got), 0o600))
		return got
	}
	want, err := os.ReadFile(p)
	require.NoError(t, err, "run go test ./render/ -update to create it")
	return string(want)
}

func TestRenderTitleFallback(t *testing.T) {
	tests := []struct {
		name, src, docPath, want string
	}{
		{"first h1 wins", "# Первый\n\n# Второй\n", "a/b.md", "Первый"},
		{"setext h1", "Заголовок\n=========\n", "a/b.md", "Заголовок"},
		{"h2 only falls back to the file name", "## Второй уровень\n", "a/дока.md", "дока"},
		{"no headings", "просто текст\n", "notes/readme.md", "readme"},
		{"empty doc path", "просто текст\n", "", ""},
		{"inline markup is unwrapped", "# `код` и *курсив*\n", "a/b.md", "код и курсив"},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := r.Render([]byte(tt.src), tt.docPath)
			require.NoError(t, err)
			assert.Equal(t, tt.want, res.Title)
		})
	}
}

func TestRenderInlineMatchesRender(t *testing.T) {
	// arrange
	src, err := os.ReadFile(filepath.Join("testdata", "md", "heading-in-list.md"))
	require.NoError(t, err)
	r := New(Options{})

	// act
	full, err := r.Render(src, "docs/heading-in-list.md")
	require.NoError(t, err)
	inline, err := r.RenderInline(src, "docs/heading-in-list.md")

	// assert
	require.NoError(t, err)
	assert.Equal(t, full.HTML, inline)
}

func TestRendererConcurrent(t *testing.T) {
	// arrange
	r := New(Options{})
	src := []byte("# Общее\n\n[ссылка](sub/файл.md#Общее)\n\n## Общее\n\n## Общее\n")
	want, err := r.Render(src, "one/two/doc.md")
	require.NoError(t, err)

	// act
	var wg sync.WaitGroup
	results := make([]Result, 16)
	for i := range results {
		wg.Go(func() {
			res, err := r.Render(src, "one/two/doc.md")
			assert.NoError(t, err)
			results[i] = res
		})
	}
	wg.Wait()

	// assert
	for _, res := range results {
		assert.Equal(t, want, res)
	}
}

func TestRendererConcurrentDifferentDirs(t *testing.T) {
	// arrange
	r := New(Options{})
	dirs := []string{"a/one.md", "b/c/two.md", "three.md"}
	want := make([]Result, len(dirs))
	for i, doc := range dirs {
		res, err := r.Render([]byte("[x](img.png)\n"), doc)
		require.NoError(t, err)
		want[i] = res
	}

	// act & assert
	var wg sync.WaitGroup
	for range 32 {
		for i, doc := range dirs {
			wg.Go(func() {
				res, err := r.Render([]byte("[x](img.png)\n"), doc)
				assert.NoError(t, err)
				assert.Equal(t, want[i], res)
			})
		}
	}
	wg.Wait()
}

func TestContentDir(t *testing.T) {
	tests := []struct{ in, want string }{
		{"a/b/c.md", "a/b"},
		{"c.md", ""},
		{"/c.md", ""},
		{"./a/c.md", "a"},
		{"../../a/c.md", "a"},
		{"", ""},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			assert.Equal(t, tt.want, contentDir(tt.in))
		})
	}
}

func BenchmarkRenderLargeDocument(b *testing.B) {
	root := os.Getenv("MDSERVER_CORPUS")
	if root == "" {
		b.Skip("MDSERVER_CORPUS is not set")
	}
	src, err := os.ReadFile(filepath.Join(root, "python", "python-notes-index.md"))
	require.NoError(b, err)
	r := New(Options{})
	b.ReportAllocs()
	for b.Loop() {
		if _, err := r.Render(src, "python/python-notes-index.md"); err != nil {
			b.Fatal(err)
		}
	}
}
