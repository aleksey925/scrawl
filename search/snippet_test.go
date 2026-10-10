package search

import (
	"html/template"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSnippetEscapesDocumentText(t *testing.T) {
	ix := loadNotes(t)
	tests := []struct {
		name      string
		query     string
		want      string
		forbidden string
	}{
		{
			name:      "script tag from a code fence",
			query:     "опасность",
			want:      `&lt;script&gt;alert(&#34;<mark>опасность</mark>&#34;)&lt;/script&gt;`,
			forbidden: "<script>",
		},
		{
			name:      "mark tag from the document",
			query:     "подсветка",
			want:      `&lt;mark&gt;<mark>подсветка</mark>&lt;/mark&gt;`,
			forbidden: "<mark>подсветка</mark></mark>",
		},
		{
			name:      "angle brackets in prose",
			query:     "скобки",
			want:      "5 &lt; 7 и a &gt; b",
			forbidden: "5 < 7",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			hits := ix.Search(tt.query, 5)
			require.Len(t, hits, 1)
			assert.Contains(t, string(hits[0].Snippet), tt.want)
			assert.NotContains(t, string(hits[0].Snippet), tt.forbidden)
		})
	}
}

func TestSnippetPrefersProseOverCode(t *testing.T) {
	// arrange
	ix := loadNotes(t)

	// act
	hits := ix.Search("nginx", 5)

	// assert
	require.Len(t, hits, 1)
	assert.Contains(t, string(hits[0].Snippet), "Образ <mark>nginx</mark> собирается")
	assert.NotContains(t, string(hits[0].Snippet), "image:")
}

func TestSnippetWindow(t *testing.T) {
	// arrange
	tail := strings.Repeat("хвост ", 40)
	ix := indexOf(map[string]string{
		"a.md": "Заголовок\n=========\n\n" + strings.Repeat("начало ", 40) + "ключевоеслово " + tail,
	})

	// act
	hits := ix.Search("ключевоеслово", 5)

	// assert
	require.Len(t, hits, 1)
	snippet := string(hits[0].Snippet)
	assert.True(t, strings.HasPrefix(snippet, ellipsis), snippet)
	assert.True(t, strings.HasSuffix(snippet, ellipsis), snippet)
	assert.Contains(t, snippet, "начало <mark>ключевоеслово</mark> хвост")
	assert.LessOrEqual(t, utf8.RuneCountInString(bareText(snippet)), snippetRunes)
}

func TestSnippetShortDocumentHasNoEllipsis(t *testing.T) {
	// arrange
	ix := indexOf(map[string]string{"a.md": "Заголовок\n=========\n\nкороткий текст заметки\n"})

	// act
	hits := ix.Search("короткий", 5)

	// assert
	require.Len(t, hits, 1)
	assert.Equal(t, template.HTML("Заголовок <mark>короткий</mark> текст заметки"), hits[0].Snippet)
}

func TestSnippetMarksEveryTerm(t *testing.T) {
	// arrange
	ix := loadNotes(t)

	// act
	hits := ix.Search("резервное копирование", 1)

	// assert
	require.Len(t, hits, 1)
	assert.Contains(t, string(hits[0].Snippet), "<mark>Резервное</mark> <mark>копирование</mark>")
}

func TestSnippetForTitleOnlyMatch(t *testing.T) {
	// arrange
	ix := indexOf(map[string]string{"заметки/бэкап.md": "текст без совпадений\n"})

	// act
	hits := ix.Search("бэкап", 5)

	// assert
	require.Len(t, hits, 1)
	assert.Equal(t, template.HTML("текст без совпадений"), hits[0].Snippet)
	assert.Equal(t, 1, hits[0].Line)
}

func TestCollapseWindow(t *testing.T) {
	tests := []struct {
		name      string
		text      string
		marks     []mark
		want      string
		wantMarks []mark
	}{
		{"whitespace runs squeezed", "  a  \n\n  b  ", nil, "a b", []mark{}},
		{
			name:      "mark offsets follow the text",
			text:      "первый \n\n второй третий",
			marks:     []mark{{start: 16, end: 28, term: 0}},
			want:      "первый второй третий",
			wantMarks: []mark{{start: 13, end: 25, term: 0}},
		},
		{
			name:      "mark at the very end",
			text:      "текст конец",
			marks:     []mark{{start: 11, end: 21, term: 1}},
			want:      "текст конец",
			wantMarks: []mark{{start: 11, end: 21, term: 1}},
		},
		{"empty", "", nil, "", []mark{}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			text, marks := collapseWindow(tt.text, tt.marks)
			assert.Equal(t, tt.want, text)
			assert.Equal(t, tt.wantMarks, marks)
		})
	}
}

func TestRenderSnippet(t *testing.T) {
	tests := []struct {
		name  string
		text  string
		marks []mark
		lead  bool
		tail  bool
		want  template.HTML
	}{
		{"plain text", "текст", nil, false, false, "текст"},
		{"escaped", `<b>&"</b>`, nil, false, false, `&lt;b&gt;&amp;&#34;&lt;/b&gt;`},
		{"marked", "сеть тут", []mark{{start: 0, end: 8}}, false, false, "<mark>сеть</mark> тут"},
		{"ellipsis on both sides", "текст", nil, true, true, "…текст…"},
		{"overlapping marks are dropped", "сеть", []mark{{start: 0, end: 8}, {start: 2, end: 8}}, false, false, "<mark>сеть</mark>"},
		{"mark out of range is dropped", "сеть", []mark{{start: 0, end: 99}}, false, false, "сеть"},
		{"empty mark is dropped", "сеть", []mark{{start: 2, end: 2}}, false, false, "сеть"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, renderSnippet(tt.text, tt.marks, tt.lead, tt.tail))
		})
	}
}

func TestWordBoundaries(t *testing.T) {
	text := "первое второе третье"

	t.Run("start leaves the word it landed in", func(t *testing.T) {
		assert.Equal(t, []int{0, 13, 13}, []int{
			wordStart(text, 0, 20), wordStart(text, 8, 20), wordStart(text, 13, 20),
		})
	})

	t.Run("start never passes the limit", func(t *testing.T) {
		assert.Equal(t, 8, wordStart(text, 8, 8))
	})

	t.Run("end backs off to the last whole word", func(t *testing.T) {
		assert.Equal(t, []int{13, 12, len(text)}, []int{
			wordEnd(text, 17, 0), wordEnd(text, 12, 0), wordEnd(text, len(text), 0),
		})
	})

	t.Run("end never goes below the least", func(t *testing.T) {
		assert.Equal(t, 17, wordEnd(text, 17, 17))
	})
}

// bareText strips the markup a snippet is allowed to carry, leaving the
// document text itself.
func bareText(snippet string) string {
	return strings.NewReplacer("<mark>", "", "</mark>", "", ellipsis, "").Replace(snippet)
}
