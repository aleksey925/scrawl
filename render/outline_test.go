package render

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOutline(t *testing.T) {
	tests := []struct {
		name, src string
		want      []Heading
	}{
		{
			name: "setext and atx mix, levels may jump",
			src:  "Web Servers\n===========\n\n# Оглавление\n\n### Сравнение nginx и apache\n",
			want: []Heading{
				{Level: 1, Text: "Web Servers", ID: "web-servers"},
				{Level: 1, Text: "Оглавление", ID: "оглавление"},
				{Level: 3, Text: "Сравнение nginx и apache", ID: "сравнение-nginx-и-apache"},
			},
		},
		{
			name: "h5 and h6 stay out of the rail",
			src:  "# a\n\n#### b\n\n##### c\n\n###### d\n",
			want: []Heading{
				{Level: 1, Text: "a", ID: "a"},
				{Level: 4, Text: "b", ID: "b"},
			},
		},
		{
			name: "repeated headings get suffixed ids",
			src:  "## Общее\n\n## Общее\n\n## Общее\n",
			want: []Heading{
				{Level: 2, Text: "Общее", ID: "общее"},
				{Level: 2, Text: "Общее", ID: "общее-1"},
				{Level: 2, Text: "Общее", ID: "общее-2"},
			},
		},
		{
			name: "inline markup is flattened",
			src:  "## Отличие `__getattr__` от **чего-то** и [ссылки](x.md)\n",
			want: []Heading{{
				Level: 2,
				Text:  "Отличие __getattr__ от чего-то и ссылки",
				ID:    "отличие-__getattr__-от-чего-то-и-ссылкиxmd",
			}},
		},
		{
			name: "no headings",
			src:  "просто текст\n",
		},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := r.Render([]byte(tt.src), "a/b.md")
			require.NoError(t, err)
			assert.Equal(t, tt.want, res.TOC)
		})
	}
}

func TestOutlineIgnoresRawHTMLInHeadings(t *testing.T) {
	// a manual anchor right above a setext heading is swallowed into it
	res, err := New(Options{}).Render([]byte("<a name='Общее'></a>\nЗаголовок\n=========\n"), "a/b.md")

	require.NoError(t, err)
	assert.Equal(t, "Заголовок", res.Title)
	assert.Equal(t, []Heading{{Level: 1, Text: "Заголовок", ID: "заголовок"}}, res.TOC)
}

func TestTitleFromPath(t *testing.T) {
	tests := []struct{ in, want string }{
		{"a/b/заметки.md", "заметки"},
		{"index.md", "index"},
		{"a/b/", "b"},
		{"", ""},
		{"/", ""},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			assert.Equal(t, tt.want, titleFromPath(tt.in))
		})
	}
}
