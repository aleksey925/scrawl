package search

import (
	"fmt"
	"io/fs"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"

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
		assert.Empty(t, ix.Search("альфа", 10))
		assert.Equal(t, []string{"a.md"}, pathsOf(ix.Search("бета", 10)))
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
		assert.Equal(t, []string{"index.md", "notes/unicode.md"}, pathsOf(ix.Search("резервное копирование", 10)))
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

func TestIndexSearchRanking(t *testing.T) {
	tests := []struct {
		name  string
		docs  map[string]string
		query string
		want  []string
	}{
		{
			name:  "title beats heading beats body beats code",
			query: "мониторинг",
			want:  []string{"rank/title.md", "rank/heading.md", "rank/body.md", "rank/code.md"},
		},
		{
			name: "one title match beats many body matches",
			docs: map[string]string{
				"title.md": "Мониторинг\n==========\n\nтекст без ключевого слова\n",
				"body.md":  "Заметка\n=======\n\nмониторинг мониторинг мониторинг мониторинг\n",
			},
			query: "мониторинг",
			want:  []string{"title.md", "body.md"},
		},
		{
			name: "more occurrences rank higher",
			docs: map[string]string{
				"many.md": "Заметка\n=======\n\nсеть сеть сеть сеть\n",
				"one.md":  "Заметка\n=======\n\nсеть один два три\n",
			},
			query: "сеть",
			want:  []string{"many.md", "one.md"},
		},
		{
			name: "match closer to the start ranks higher",
			docs: map[string]string{
				"early.md": "Заметка\n=======\n\nсеть в начале документа.\n\n" + filler,
				"late.md":  "Заметка\n=======\n\n" + filler + "\n\nсеть в конце документа.\n",
			},
			query: "сеть",
			want:  []string{"early.md", "late.md"},
		},
		{
			name: "terms standing close rank higher",
			docs: map[string]string{
				"near.md": "Заметка\n=======\n\nрезервное копирование включено. " + filler,
				"far.md":  "Заметка\n=======\n\nрезервное хранение включено. " + filler + " копирование\n",
			},
			query: "резервное копирование",
			want:  []string{"near.md", "far.md"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ix := loadNotes(t)
			if tt.docs != nil {
				ix = indexOf(tt.docs)
			}
			assert.Equal(t, tt.want, pathsOf(ix.Search(tt.query, 10)))
		})
	}
}

func TestIndexSearchMatching(t *testing.T) {
	ix := loadNotes(t)
	tests := []struct {
		name  string
		query string
		want  []string
	}{
		{"single term", "восстановление", []string{"notes/бэкап.md"}},
		{"case does not matter", "УСТАНОВКА", []string{"docker/setup.md"}},
		{"all terms must be present", "резервное копирование",
			[]string{"notes/бэкап.md", "index.md", "notes/unicode.md"}},
		{"one missing term drops the document", "резервное nginx", []string{}},
		{"link text is indexed", "compose", []string{"docker/compose.md", "index.md"}},
		{"link target is not indexed", "setup", []string{}},
		{"image alt is indexed", "схема", []string{"docker/setup.md"}},
		{"image target is not indexed", "png", []string{}},
		{"html attribute is not indexed", "name", []string{}},
		{"code is searchable", "systemctl", []string{"rank/code.md"}},
		{"yo matches ye", "еще", []string{"notes/unicode.md"}},
		{"ye matches yo", "ещё", []string{"notes/unicode.md"}},
		{"decomposed query matches composed text", "же\u0308лтый", []string{"notes/unicode.md"}},
		{"zero width space inside a word", "контейнер", []string{"notes/unicode.md"}},
		{"combining accent inside a word", "поверх", []string{"notes/unicode.md"}},
		{"non breaking space splits words", "неразрывный пробел", []string{"notes/unicode.md"}},
		{"phrase over a non breaking space", `"резервное копирование"`,
			[]string{"notes/бэкап.md", "index.md", "notes/unicode.md"}},
		{"phrase in the wrong order", `"копирование резервное"`, []string{}},
		{"phrase with a word between", `"резервное данных"`, []string{}},
		{"unbalanced quote is still a phrase", `"резервное копирование`,
			[]string{"notes/бэкап.md", "index.md", "notes/unicode.md"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, pathsOf(ix.Search(tt.query, 10)))
		})
	}
}

func TestIndexSearchPrefix(t *testing.T) {
	ix := loadNotes(t)
	tests := []struct {
		name  string
		query string
		want  []string
	}{
		{"last term matches by prefix", "копир", []string{"notes/бэкап.md", "index.md", "notes/unicode.md"}},
		{"complete term still matches", "копирование", []string{"notes/бэкап.md", "index.md", "notes/unicode.md"}},
		{"only the last term is expanded", "резервн копирование", []string{}},
		{"earlier terms stay exact", "резервное копир", []string{"notes/бэкап.md", "index.md", "notes/unicode.md"}},
		{"trailing space takes the term literally", "копир ", []string{}},
		{"trailing punctuation takes the term literally", "копир.", []string{}},
		{"quoted term is never expanded", `"резервное копир"`, []string{}},
		{"prefix of nothing finds nothing", "щщщ", []string{}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, pathsOf(ix.SearchPrefix(tt.query, 10)))
		})
	}

	t.Run("plain search does not expand", func(t *testing.T) {
		assert.Empty(t, ix.Search("копир", 10))
	})
}

func TestIndexSearchPrefixRanking(t *testing.T) {
	// arrange
	ix := indexOf(map[string]string{
		"exact.md":  "Заметка\n=======\n\nсервер в этом документе\n",
		"longer.md": "Заметка\n=======\n\nсерверами в этом документе\n",
	})

	// act
	hits := ix.SearchPrefix("сервер", 10)

	// assert
	assert.Equal(t, []string{"exact.md", "longer.md"}, pathsOf(hits))
	assert.Contains(t, string(hits[1].Snippet), "<mark>серверами</mark>")
}

func TestIndexSearchPrefixStaysBounded(t *testing.T) {
	// arrange
	ix := loadNotes(t)

	// act
	hits := ix.SearchPrefix("с", 5)

	// assert
	assert.NotPanics(t, func() { ix.SearchPrefix("с", 5) })
	assert.LessOrEqual(t, len(hits), 5)
	assert.LessOrEqual(t, len(ix.prefixMatches("с")), maxPrefixTerms)
}

func TestIndexSearchPrefixAfterUpdate(t *testing.T) {
	// arrange
	ix := New()
	ix.Set("a.md", []byte("Заметка\n=======\n\nсерверами\n"))
	require.NotEmpty(t, ix.SearchPrefix("сервер", 5))

	// act
	ix.Set("a.md", []byte("Заметка\n=======\n\nхранилищем\n"))

	// assert
	assert.Empty(t, ix.SearchPrefix("сервер", 5))
	assert.Equal(t, []string{"a.md"}, pathsOf(ix.SearchPrefix("хранил", 5)))
}

func TestIndexSearchDegenerateQuery(t *testing.T) {
	ix := loadNotes(t)
	tests := []struct {
		name  string
		query string
		limit int
	}{
		{"empty", "", 10},
		{"whitespace only", " \t\n ", 10},
		{"non breaking space only", "\u00a0", 10},
		{"punctuation only", "!!! ??? ...", 10},
		{"regex metacharacters", `(.*)+[a-z]{2,}\\`, 10},
		{"quotes only", `""`, 10},
		{"single letter", "щ", 10},
		{"very long query", strings.Repeat("несуществующее слово ", 2000), 10},
		{"one long token", strings.Repeat("щ", 100000), 10},
		{"zero limit", "мониторинг", 0},
		{"negative limit", "мониторинг", -5},
		{"invalid utf8", "\xff\xfe", 10},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.NotPanics(t, func() { ix.Search(tt.query, tt.limit) })
			assert.Empty(t, ix.Search(tt.query, tt.limit))
		})
	}
}

func TestIndexSearchLimit(t *testing.T) {
	// arrange
	ix := loadNotes(t)

	// act
	hits := ix.Search("мониторинг", 2)

	// assert
	assert.Len(t, hits, 2)
	assert.Equal(t, []string{"rank/title.md", "rank/heading.md"}, pathsOf(hits))
}

func TestIndexSearchHit(t *testing.T) {
	ix := loadNotes(t)

	t.Run("title and line point at the source", func(t *testing.T) {
		hits := ix.Search("nginx", 5)
		require.Len(t, hits, 1)
		assert.Equal(t, "docker/compose.md", hits[0].Path)
		assert.Equal(t, "Docker Compose", hits[0].Title)
		assert.Equal(t, 14, hits[0].Line)
		assert.Positive(t, hits[0].Score)
	})

	t.Run("title falls back to the file name", func(t *testing.T) {
		ix := indexOf(map[string]string{"заметки/без-заголовка.md": "просто текст\n"})
		hits := ix.Search("текст", 5)
		require.Len(t, hits, 1)
		assert.Equal(t, "без-заголовка", hits[0].Title)
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
					ix.Search("мониторинг сети", 5)
					ix.SearchPrefix("монитор", 5)
					ix.Search(`"резервное копирование"`, 5)
					ix.Len()
					ix.Size()
				}
			}
		})
	}
	wg.Wait()

	// assert
	assert.NotEmpty(t, ix.Search("мониторинг", 5))
}

func FuzzSearch(f *testing.F) {
	seeds := []struct{ doc, query string }{
		{"Заголовок\n=========\n\nтекст документа\n", "текст"},
		{"# Раздел\n\n```go\nкод\n```\n", `"раздел код"`},
		{"[ссылка](a.md) <b>жирный</b> ![альт](i.png)\n", "ссылка альт"},
		{"", ""},
	}
	for _, s := range seeds {
		f.Add(s.doc, s.query)
	}

	f.Fuzz(func(t *testing.T, doc, query string) {
		ix := New()
		ix.Set("fuzz.md", []byte(doc))
		hits := ix.Search(query, 3)
		require.LessOrEqual(t, len(hits), 3)
		for _, h := range hits {
			snippet := string(h.Snippet)
			require.True(t, utf8.ValidString(snippet) || !utf8.ValidString(doc))
			bare := strings.NewReplacer("<mark>", "", "</mark>", "").Replace(snippet)
			require.NotContains(t, bare, "<")
			require.NotContains(t, bare, ">")
			require.Positive(t, h.Line)
		}
	})
}

func BenchmarkSearch(b *testing.B) {
	ix := benchIndex(b, 300, 60)
	b.Logf("documents: %d, index size: %.1f MB", ix.Len(), float64(ix.Size())/(1<<20))

	benchmarks := []struct {
		name  string
		query string
	}{
		{"one term", "мониторинг"},
		{"two terms", "резервное копирование"},
		{"three terms", "настройка сеть контейнера"},
		{"phrase", `"резервное копирование"`},
		{"no match", "несуществующееслово"},
	}

	for _, bm := range benchmarks {
		b.Run(bm.name, func(b *testing.B) {
			for b.Loop() {
				ix.Search(bm.query, 10)
			}
		})
	}

	prefixes := []struct {
		name  string
		query string
	}{
		{"prefix one term", "монитор"},
		{"prefix two terms", "резервное копир"},
		{"prefix one letter", "к"},
	}

	for _, bm := range prefixes {
		b.Run(bm.name, func(b *testing.B) {
			for b.Loop() {
				ix.SearchPrefix(bm.query, 10)
			}
		})
	}
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

// filler pads a fixture so two documents compared by ranking have the same
// length and differ only in where the query terms sit.
const filler = "остальной текст заметки нужен только чтобы документы были одинаковой длины " +
	"и отличались лишь местом совпадения внутри текста документа заметки"

var benchWords = strings.Fields(`настройка сервер сеть контейнер образ резервное копирование данных
	хранилище метрика мониторинг запуск команда файл каталог пользователь группа демон служба
	политика доступа журнал ошибка отладка сборка тег ветка коммит слияние конфликт`)

func benchIndex(tb testing.TB, docs, lines int) *Index {
	tb.Helper()

	rnd := rand.New(rand.NewSource(1))
	ix := New()
	var b strings.Builder
	for d := range docs {
		b.Reset()
		fmt.Fprintf(&b, "Заметка номер %d\n===============\n\n", d)
		for l := range lines {
			if l%10 == 0 {
				b.WriteString("\n## Раздел про сеть и контейнера\n\n")
			}
			for range 12 {
				b.WriteString(benchWords[rnd.Intn(len(benchWords))])
				b.WriteByte(' ')
			}
			b.WriteByte('\n')
		}
		ix.Set(fmt.Sprintf("dir%d/doc%d.md", d%20, d), []byte(b.String()))
	}
	return ix
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

func pathsOf(hits []Hit) []string {
	res := make([]string, 0, len(hits))
	for _, h := range hits {
		res = append(res, h.Path)
	}
	return res
}
