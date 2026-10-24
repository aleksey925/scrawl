package render

import (
	"fmt"
	"html/template"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLinkifyBareURL(t *testing.T) {
	cases := []struct {
		name   string
		src    string
		before string
		href   string
		text   string
		after  string
	}{
		{
			name:   "ascii",
			src:    "see http://example.com/a/b?q=1 end",
			before: "see ",
			href:   "http://example.com/a/b?q=1",
			text:   "http://example.com/a/b?q=1",
			after:  " end",
		},
		{
			name:   "cyrillic path and fragment",
			src:    "a http://help.ubuntu.ru/wiki/драйвер_видеокарт#неправильно_определяются end",
			before: "a ",
			href:   "http://help.ubuntu.ru/wiki/%D0%B4%D1%80%D0%B0%D0%B9%D0%B2%D0%B5%D1%80_%D0%B2%D0%B8%D0%B4%D0%B5%D0%BE%D0%BA%D0%B0%D1%80%D1%82#%D0%BD%D0%B5%D0%BF%D1%80%D0%B0%D0%B2%D0%B8%D0%BB%D1%8C%D0%BD%D0%BE_%D0%BE%D0%BF%D1%80%D0%B5%D0%B4%D0%B5%D0%BB%D1%8F%D1%8E%D1%82%D1%81%D1%8F",
			text:   "http://help.ubuntu.ru/wiki/драйвер_видеокарт#неправильно_определяются",
			after:  " end",
		},
		{
			name:   "cyrillic host",
			src:    "b http://пример.рф/путь end",
			before: "b ",
			href:   "http://%D0%BF%D1%80%D0%B8%D0%BC%D0%B5%D1%80.%D1%80%D1%84/%D0%BF%D1%83%D1%82%D1%8C",
			text:   "http://пример.рф/путь",
			after:  " end",
		},
		{
			name:   "www with cyrillic host",
			src:    "c www.пример.рф/путь end",
			before: "c ",
			href:   "http://www.%D0%BF%D1%80%D0%B8%D0%BC%D0%B5%D1%80.%D1%80%D1%84/%D0%BF%D1%83%D1%82%D1%8C",
			text:   "www.пример.рф/путь",
			after:  " end",
		},
		{
			name:   "trailing period",
			src:    "d http://x.ru/путь. end",
			before: "d ",
			href:   "http://x.ru/%D0%BF%D1%83%D1%82%D1%8C",
			text:   "http://x.ru/путь",
			after:  ". end",
		},
		{
			name:   "inside parentheses",
			src:    "e (http://x.ru/путь) end",
			before: "e (",
			href:   "http://x.ru/%D0%BF%D1%83%D1%82%D1%8C",
			text:   "http://x.ru/путь",
			after:  ") end",
		},
		{
			name:   "trailing comma",
			src:    "f http://x.ru/путь, end",
			before: "f ",
			href:   "http://x.ru/%D0%BF%D1%83%D1%82%D1%8C",
			text:   "http://x.ru/путь",
			after:  ", end",
		},
		{
			name:   "cyrillic query",
			src:    "g http://x.ru/a?q=слово&b=ё end",
			before: "g ",
			href:   "http://x.ru/a?q=%D1%81%D0%BB%D0%BE%D0%B2%D0%BE&amp;b=%D1%91",
			text:   "http://x.ru/a?q=слово&amp;b=ё",
			after:  " end",
		},
		{
			name:   "non-ascii punctuation stays in",
			src:    "h http://x.ru/путь— end",
			before: "h ",
			href:   "http://x.ru/%D0%BF%D1%83%D1%82%D1%8C%E2%80%94",
			text:   "http://x.ru/путь—",
			after:  " end",
		},
		{
			name:   "balanced parentheses",
			src:    "i https://ru.wikipedia.org/wiki/Пример_(значения) end",
			before: "i ",
			href:   "https://ru.wikipedia.org/wiki/%D0%9F%D1%80%D0%B8%D0%BC%D0%B5%D1%80_(%D0%B7%D0%BD%D0%B0%D1%87%D0%B5%D0%BD%D0%B8%D1%8F)",
			text:   "https://ru.wikipedia.org/wiki/Пример_(значения)",
			after:  " end",
		},
		{
			name:   "stops at angle bracket",
			src:    "x http://x.ru/a<b end",
			before: "x ",
			href:   "http://x.ru/a",
			text:   "http://x.ru/a",
			after:  "&lt;b end",
		},
	}
	r := New(Options{})
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			want := template.HTML(fmt.Sprintf(
				"<p data-source-start=\"1\" data-source-end=\"1\">%s<a href=%q target=\"_blank\" rel=\"noopener noreferrer nofollow\">%s</a>%s</p>\n",
				tc.before, tc.href, tc.text, tc.after))

			// act
			got, err := r.RenderInline([]byte(tc.src), "docs/a.md")

			// assert
			require.NoError(t, err)
			assert.Equal(t, want, got)
		})
	}
}
