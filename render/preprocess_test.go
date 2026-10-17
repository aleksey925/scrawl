package render

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPreprocessFenceLanguage(t *testing.T) {
	tests := []struct{ name, in, want string }{
		{"docker compose", "```docker-compose\nservices:\n```\n", "```yaml\nservices:\n```\n"},
		{"cmd", "```cmd\ndir\n```\n", "```batch\ndir\n```\n"},
		{"unknown is left alone", "```brainfuck\n+++\n```\n", "```brainfuck\n+++\n```\n"},
		{"no language", "```\ntext\n```\n", "```\ntext\n```\n"},
		{"indented fence in a list", "- item\n\n    ```cmd\n    dir\n    ```\n", "- item\n\n    ```batch\n    dir\n    ```\n"},
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

func TestFrontmatter(t *testing.T) {
	tests := []struct{ name, in, want string }{
		{"yaml block", "---\ntitle: x\n---\n# Заголовок\n", "---\ntitle: x\n---"},
		{"closed with dots", "---\ntitle: x\n...\nтекст\n", "---\ntitle: x\n..."},
		{"no frontmatter", "# Заголовок\n\n---\n", ""},
		{"unterminated block", "---\ntitle: x\n", ""},
		{"empty document", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// act
			got := Frontmatter([]byte(tt.in))

			// assert
			assert.Equal(t, tt.want, got)
		})
	}
}
