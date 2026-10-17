package search

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalize(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"already nfc", "ёлка", "ёлка"},
		{"decomposed yo", "\u0435\u0308лка", "\u0451лка"},
		{"decomposed short i", "\u0438\u0306огурт", "\u0439огурт"},
		{"accent stays decomposed", "пове\u0301рх", "пове\u0301рх"},
		{"empty", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, normalize(tt.input))
		})
	}
}

func TestTokenize(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []string
	}{
		{"russian words", "Настройка сервера", []string{"настройка", "сервера"}},
		{"case folded", "ОБЩЕЕ Общее общее", []string{"общее", "общее", "общее"}},
		{"yo folded to ye", "Ещё жёлтый", []string{"еще", "желтый"}},
		{"latin works too", "Docker Compose", []string{"docker", "compose"}},
		{"punctuation splits", "ГОСТ-Р 34.10, версия 2.0 (см. RFC-4357)!",
			[]string{"гост", "р", "34", "10", "версия", "2", "0", "см", "rfc", "4357"}},
		{"nbsp splits words", "резервное\u00a0копирование", []string{"резервное", "копирование"}},
		{"zero width space glues", "кон\u200bтейнер", []string{"контейнер"}},
		{"soft hyphen glues", "кон\u00adтейнер", []string{"контейнер"}},
		{"byte order mark glues", "кон\ufeffтейнер", []string{"контейнер"}},
		{"combining accent dropped", "пове\u0301рх", []string{"поверх"}},
		{"underscore splits", "snake_case", []string{"snake", "case"}},
		{"long term skipped", strings.Repeat("щ", maxTermRunes+1), []string{}},
		{"long digit run skipped", "12345678901", []string{}},
		{"digit run kept", "1234567890", []string{"1234567890"}},
		{"only punctuation", "!!! ??? ... ---", []string{}},
		{"empty", "", []string{}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, termsOf(tokenize(normalize(tt.input))))
		})
	}
}

func TestTokenizeOffsets(t *testing.T) {
	// arrange
	text := "Сеть\u00a0контейнеров"

	// act & assert
	assert.Equal(t, []token{{term: "сеть", off: 0}, {term: "контейнеров", off: 10}}, tokenize(text))
}

func TestMatchAt(t *testing.T) {
	tests := []struct {
		name string
		text string
		term string
		at   int
		want int
	}{
		{"exact", "сервер", "сервер", 0, 12},
		{"case folded", "Сервер", "сервер", 0, 12},
		{"yo folded", "ещё", "еще", 0, 6},
		{"whole token only", "серверы", "сервер", 0, -1},
		{"stops at punctuation", "сервер.", "сервер", 0, 12},
		{"zero width inside", "кон\u200bтейнер.", "контейнер", 0, 21},
		{"accent inside", "пове\u0301рх ", "поверх", 0, 14},
		{"offset in the middle", "на сервер", "сервер", 5, 17},
		{"no match", "сервер", "сеть", 0, -1},
		{"empty term", "сервер", "", 0, -1},
		{"offset past end", "сервер", "сервер", 99, -1},
		{"negative offset", "сервер", "сервер", -1, -1},
		{"term longer than text", "сер", "сервер", 0, -1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, matchAt(tt.text, tt.term, tt.at))
		})
	}
}

func TestPhraseAt(t *testing.T) {
	terms := []string{"резервное", "копирование"}
	tests := []struct {
		name string
		text string
		want bool
	}{
		{"plain space", "резервное копирование", true},
		{"non breaking space", "резервное\u00a0копирование", true},
		{"line break", "резервное\nкопирование", true},
		{"punctuation between", "резервное - копирование", true},
		{"word between", "резервное полное копирование", false},
		{"wrong order", "копирование резервное", false},
		{"prefix only", "резервное копированию", false},
		{"truncated", "резервное", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, phraseAt(tt.text, terms, 0))
		})
	}
}

func TestRuneWalking(t *testing.T) {
	text := "сеть"

	t.Run("advance", func(t *testing.T) {
		assert.Equal(t, []int{0, 4, 8}, []int{advanceRunes(text, 0, 0), advanceRunes(text, 0, 2), advanceRunes(text, 0, 99)})
	})

	t.Run("retreat", func(t *testing.T) {
		assert.Equal(t, []int{8, 4, 0}, []int{retreatRunes(text, 8, 0), retreatRunes(text, 8, 2), retreatRunes(text, 8, 99)})
	})

	t.Run("cut keeps runes whole", func(t *testing.T) {
		require.Equal(t, "се", cutBytes(text, 5))
		require.Equal(t, text, cutBytes(text, 99))
	})
}

func termsOf(tokens []token) []string {
	res := make([]string, 0, len(tokens))
	for _, t := range tokens {
		res = append(res, t.term)
	}
	return res
}
