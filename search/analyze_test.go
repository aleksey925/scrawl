package search

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAnalyzePlain(t *testing.T) {
	tests := []struct {
		name string
		src  string
		want string
	}{
		{"heading markers", "## Установка", "Установка"},
		{"closed atx heading", "## Установка ##", "Установка"},
		{"hash without space is not a heading", "#хэштег", "#хэштег"},
		{"bullet marker", "- пункт списка", "пункт списка"},
		{"ordered marker", "3. пункт списка", "пункт списка"},
		{"nested bullet", "        - глубокий пункт", "глубокий пункт"},
		{"blockquote", ">цитата без пробела", "цитата без пробела"},
		{"link keeps text drops url", "см. [сайт проекта](https://example.com/x)", "см. сайт проекта"},
		{"reference link", "см. [сайт][ref] дальше", "см. сайт дальше"},
		{"image keeps alt drops url", "![схема сети](images/net.png)", "схема сети"},
		{"html tag dropped", "<a name='общее'></a>Общее", "Общее"},
		{"autolink dropped", "ссылка <https://example.com> тут", "ссылка  тут"},
		{"inline code kept", "команда `docker run` тут", "команда docker run тут"},
		{"emphasis dropped", "**жирный** и ~~зачёркнутый~~", "жирный и зачёркнутый"},
		{"escaped punctuation kept", `звёздочка \* тут`, "звёздочка * тут"},
		{"lone bracket kept", "массив [1", "массив [1"},
		{"lone angle bracket kept", "5 < 7 и a > b", "5 < 7 и a > b"},
		{"unclosed tag kept", "меньше <b чем", "меньше <b чем"},
		{"thematic break dropped", "текст\n\n---\n\nещё", "текст\n\nещё"},
		{"table rule dropped", "| a | b |\n|---|---|\n| 1 | 2 |", "| a | b |\n\n| 1 | 2 |"},
		{"fence markers dropped", "```bash\ndocker run\n```", "docker run"},
		{"indented fence in a list", "- пункт\n\n   ```\n   код\n   ```", "пункт\n\n   код"},
		{"fence closed with trailing spaces", "```\nкод\n```  ", "код"},
		{"unclosed fence", "```\nкод", "код"},
		{"blocks are split by a blank line", "текст\n\n\n\nещё", "текст\n\nещё"},
		{"windows line endings", "текст\r\nещё\r\n", "текст\nещё"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, strings.TrimRight(analyze("doc.md", []byte(tt.src)).plain, "\n"))
		})
	}
}

func TestAnalyzeTitle(t *testing.T) {
	tests := []struct {
		name string
		path string
		src  string
		want string
	}{
		{"setext h1", "a.md", "База знаний\n===========\n", "База знаний"},
		{"atx h1", "a.md", "# Оглавление\n", "Оглавление"},
		{"first h1 wins", "a.md", "Первый\n======\n\n# Второй\n", "Первый"},
		{"link in the title", "a.md", "# [Docker](https://docker.com)\n", "Docker"},
		{"setext h2 is not a title", "заметки/бэкап.md", "Раздел\n------\n", "бэкап"},
		{"heading in a fence is not a title", "a.md", "```\n# Не заголовок\n```\n", "a"},
		{"file name fallback", "docker/setup.md", "просто текст\n", "setup"},
		{"file name without extension", "заметки/бэкап.md", "", "бэкап"},
		{"path with no directory", "index.md", "", "index"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, analyze(tt.path, []byte(tt.src)).title)
		})
	}
}

func TestAnalyzeFields(t *testing.T) {
	// arrange
	src := "Заголовок\n=========\n\n## Раздел\n\nТекст абзаца.\n\n```go\nкод\n```\n"

	// act
	res := analyze("notes/doc.md", []byte(src))

	// assert
	byField := map[field][]string{}
	for _, t := range res.tokens {
		byField[t.field] = append(byField[t.field], t.term)
	}
	assert.Equal(t, map[field][]string{
		fieldTitle:   {"заголовок"},
		fieldHeading: {"заголовок", "раздел"},
		fieldBody:    {"текст", "абзаца"},
		fieldCode:    {"код"},
	}, byField)
}

func TestAnalyzeCodeSpans(t *testing.T) {
	// arrange
	src := "Текст\n\n```go\nкод\n```\n\nещё текст\n\n```\nвторой блок\n```\n"

	// act
	res := analyze("doc.md", []byte(src))

	// assert
	fenced := make([]string, 0, len(res.code))
	for _, s := range res.code {
		fenced = append(fenced, res.plain[s.start:s.end])
	}
	assert.Equal(t, []string{"код\n", "второй блок\n"}, fenced)
}

func TestAnalyzeLineMap(t *testing.T) {
	// arrange
	src := "Заголовок\n=========\n\nпервый абзац\n\nвторой абзац\n"

	// act
	res := analyze("doc.md", []byte(src))
	doc := &document{plain: res.plain, lines: res.lines}

	// assert
	got := make([]int, 0, 3)
	for _, term := range []string{"заголовок", "первый", "второй"} {
		i := strings.Index(strings.ToLower(doc.plain), term)
		require.GreaterOrEqual(t, i, 0)
		got = append(got, doc.lineAt(int32(i)))
	}
	assert.Equal(t, []int{1, 4, 6}, got)
}

func TestAnalyzeTruncatesHugeDocument(t *testing.T) {
	// arrange
	src := strings.Repeat("наполнение текстом\n", maxDocBytes/10) + "\nхвостовоеслово\n"

	// act
	res := analyze("doc.md", []byte(src))

	// assert
	require.LessOrEqual(t, len(res.plain), maxDocBytes)
	assert.NotContains(t, res.plain, "хвостовоеслово")
}

func TestCleanInlineNestedLink(t *testing.T) {
	tests := []struct {
		name string
		src  string
		want string
	}{
		{"link inside link text", "[внешний [внутренний](a.md) хвост](b.md)", "внешний внутренний хвост"},
		{"image inside link", "[![альт](img.png)](b.md)", "альт"},
		{"unclosed link", "[текст без закрытия", "[текст без закрытия"},
		{"unclosed destination", "[текст](без закрытия", "текст(без закрытия"},
		{"tag inside link text", "[<b>текст</b>](a.md)", "текст"},
		{"empty", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, cleanInline(tt.src))
		})
	}
}
