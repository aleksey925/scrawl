package render

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPreprocessHeadingInListItem(t *testing.T) {
	tests := []struct{ name, in, want string }{
		{
			// clean-code/clean-code-index.md:6
			name: "ordered item with h3",
			in:   "1. <h3>[Принципы проектирования](#Принципы)</h3>\n",
			want: "1. <strong class=\"md-h3\">[Принципы проектирования](#Принципы)</strong>\n",
		},
		{
			// git/git-notes-index.md:13
			name: "nested bullet item with h4",
			in:   "    - <h4>[Общая настройка](#Общая-настройка)</h4>\n",
			want: "    - <strong class=\"md-h4\">[Общая настройка](#Общая-настройка)</strong>\n",
		},
		{
			name: "mismatched tags are left alone",
			in:   "1. <h3>текст</h4>\n",
			want: "1. <h3>текст</h4>\n",
		},
		{
			name: "outside a list item it stays a real heading",
			in:   "<h3>Заголовок</h3>\n",
			want: "<h3>Заголовок</h3>\n",
		},
		{
			name: "trailing content is not a lone tag",
			in:   "1. <h3>текст</h3> хвост\n",
			want: "1. <h3>текст</h3> хвост\n",
		},
		{
			name: "inside a fence nothing changes",
			in:   "```html\n1. <h3>текст</h3>\n```\n",
			want: "```html\n1. <h3>текст</h3>\n```\n",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, string(preprocess([]byte(tt.in)).src))
		})
	}
}

func TestPreprocessDetails(t *testing.T) {
	tests := []struct{ name, in, want string }{
		{
			name: "blank line after summary",
			in:   "<details markdown=\"span\">\n<summary>S</summary>\nВнутри *курсив*\n</details>\n",
			want: "<details markdown=\"span\">\n<summary>S</summary>\n\nВнутри *курсив*\n\n</details>\n",
		},
		{
			// python/python-notes-index.md:753, already correct in the corpus
			name: "whitespace-only line already ends the block",
			in:   "<details markdown=\"span\">\n    <summary>Показать слайды</summary>\n    \n![](a.jpg)\n\n</details>\n",
			want: "<details markdown=\"span\">\n    <summary>Показать слайды</summary>\n    \n![](a.jpg)\n\n</details>\n",
		},
		{
			name: "content directly after the opening tag",
			in:   "<details>\nтекст\n</details>\n",
			want: "<details>\n\nтекст\n\n</details>\n",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, string(preprocess([]byte(tt.in)).src))
		})
	}
}

func TestPreprocessOrderedListInterruptingParagraph(t *testing.T) {
	tests := []struct{ name, in, want string }{
		{
			name: "list opening at 3 gets a blank line",
			in:   "Абзац текста.\n3. Третий\n4. Четвёртый\n",
			want: "Абзац текста.\n\n3. Третий\n4. Четвёртый\n",
		},
		{
			name: "opening at 1 needs nothing, CommonMark allows it",
			in:   "Абзац текста.\n1. Первый\n",
			want: "Абзац текста.\n1. Первый\n",
		},
		{
			// linux/linux-notes-index.md:290-294, a lazy continuation inside an
			// already open list must not be split into two lists
			name: "item after a continuation line of an open list",
			in:   "1. Установил систему.\n2. Установил драйвер и перезагрузил\n    систему.\n3. Подключил монитор.\n",
			want: "1. Установил систему.\n2. Установил драйвер и перезагрузил\n    систему.\n3. Подключил монитор.\n",
		},
		{
			name: "after a heading",
			in:   "## Заголовок\n2. Второй\n",
			want: "## Заголовок\n2. Второй\n",
		},
		{
			name: "inside a fence",
			in:   "```\nтекст\n2. второй\n```\n",
			want: "```\nтекст\n2. второй\n```\n",
		},
		{
			name: "a version number is not a list",
			in:   "Вышла версия\n1.8.6 стабильная\n",
			want: "Вышла версия\n1.8.6 стабильная\n",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, string(preprocess([]byte(tt.in)).src))
		})
	}
}

func TestPreprocessFenceLanguage(t *testing.T) {
	tests := []struct{ name, in, want string }{
		// python/python-notes-index.md:684 uses a Cyrillic "с"
		{"cyrillic es", "```с\nint x;\n```\n", "```c\nint x;\n```\n"},
		{"docker compose", "```docker-compose\nservices:\n```\n", "```yaml\nservices:\n```\n"},
		{"cmd", "```cmd\ndir\n```\n", "```batch\ndir\n```\n"},
		{"unknown is left alone", "```brainfuck\n+++\n```\n", "```brainfuck\n+++\n```\n"},
		{"no language", "```\ntext\n```\n", "```\ntext\n```\n"},
		{"indented fence in a list", "- item\n\n    ```cmd\n    dir\n    ```\n", "- item\n\n    ```batch\n    dir\n    ```\n"},
		// python/python-notes-index.md:690 closes with two trailing spaces
		{"closing fence with trailing spaces", "```cmd\ndir\n```  \nхвост\n", "```batch\ndir\n```  \nхвост\n"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, string(preprocess([]byte(tt.in)).src))
		})
	}
}

func TestPreprocessFrontmatter(t *testing.T) {
	tests := []struct{ name, in, want string }{
		{"yaml block", "---\ntitle: x\n---\n# Заголовок\n", "# Заголовок\n"},
		{"closed with dots", "---\ntitle: x\n...\nтекст\n", "текст\n"},
		{"no frontmatter", "# Заголовок\n\n---\n", "# Заголовок\n\n---\n"},
		{"unterminated block is left alone", "---\ntitle: x\n", "---\ntitle: x\n"},
		{"empty document", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, string(preprocess([]byte(tt.in)).src))
		})
	}
}

func TestRenderStripsFrontmatter(t *testing.T) {
	// act
	res, err := New(Options{}).Render([]byte("---\ntitle: Метаданные\ntags: [a, b]\n---\n# Заголовок\n"), "a/b.md")

	// assert
	require.NoError(t, err)
	assert.Equal(t, "Заголовок", res.Title)
	assert.NotContains(t, string(res.HTML), "tags")
	assert.NotContains(t, string(res.HTML), "Метаданные")
}
