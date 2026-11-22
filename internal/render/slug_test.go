package render

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/yuin/goldmark/ast"
)

func TestSlug(t *testing.T) {
	tests := []struct{ name, in, want string }{
		{"cyrillic", "Общее", "общее"},
		{"punctuation dropped", "Настройка сервера!", "настройка-сервера"},
		{"trimmed", "  Как быть?  ", "как-быть"},
		{"ascii symbols", "C++ / Go", "c--go"},
		{"yo", "Ёлка", "ёлка"},
		{"leading number", "1. Введение", "1-введение"},
		{"em dash leaves two hyphens", "Шаг 3. Почему диск — это главный враг", "шаг-3-почему-диск--это-главный-враг"},
		{"colon", "OLTP (Online Transaction Processing)", "oltp-online-transaction-processing"},
		{"hyphen kept", "Использование b-tree в базах данных", "использование-b-tree-в-базах-данных"},
		{"underscores kept", "Отличие `__getattr__` от `__getatrribute__`", "отличие-__getattr__-от-__getatrribute__"},
		{"plus is dropped", "n+1 select", "n1-select"},
		{"raw html dropped", "<a name='X'></a>Заголовок", "заголовок"},
		{"nbsp is not a space", "a b", "ab"},
		{"decomposed is composed first", "й й", "й-й"},
		{"empty", "!!!", ""},
		{"only spaces", "   ", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, Slug(tt.in))
		})
	}
}

func TestSlugIDsDedupe(t *testing.T) {
	// arrange
	ids := newSlugIDs()

	// act
	got := []string{
		string(ids.Generate([]byte("Общее"), ast.KindHeading)),
		string(ids.Generate([]byte("Общее"), ast.KindHeading)),
		string(ids.Generate([]byte("Общее"), ast.KindHeading)),
		string(ids.Generate([]byte("!!!"), ast.KindHeading)),
		string(ids.Generate([]byte("!!!"), ast.KindLink)),
	}

	// assert
	assert.Equal(t, []string{"общее", "общее-1", "общее-2", "section", "id"}, got)
}

func TestSlugIDsPutWins(t *testing.T) {
	// arrange
	ids := newSlugIDs()
	ids.Put([]byte("общее"))

	// act & assert
	assert.Equal(t, "общее-1", string(ids.Generate([]byte("Общее"), ast.KindHeading)))
}

func TestSlugIDsDedupeAroundTakenSuffix(t *testing.T) {
	// arrange
	ids := newSlugIDs()
	ids.Put([]byte("общее-1"))

	// act
	first := string(ids.Generate([]byte("Общее"), ast.KindHeading))
	second := string(ids.Generate([]byte("Общее"), ast.KindHeading))

	// assert
	assert.Equal(t, []string{"общее", "общее-2"}, []string{first, second})
}
