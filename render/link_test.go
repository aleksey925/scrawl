package render

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolve(t *testing.T) {
	tests := []struct {
		name, dest, dir string
		want            target
	}{
		{"markdown in a subdir", "foo/bar.md", "dir/sub", target{dest: "/p/dir/sub/foo/bar.md", content: "dir/sub/foo/bar.md", rewrote: true}},
		{"markdown at the root", "bar.md", "", target{dest: "/p/bar.md", content: "bar.md", rewrote: true}},
		{"parent relative with a fragment", "../other/файл.md#раздел", "dir/sub", target{
			dest:    "/p/dir/other/%D1%84%D0%B0%D0%B9%D0%BB.md#%D1%80%D0%B0%D0%B7%D0%B4%D0%B5%D0%BB",
			content: "dir/other/файл.md",
			rewrote: true,
		}},
		{"dot slash image", "./img.png", "dir/sub", target{dest: "/raw/dir/sub/img.png", content: "dir/sub/img.png", rewrote: true}},
		{"python file", "docs/spec.py", "dir", target{dest: "/raw/dir/docs/spec.py", content: "dir/docs/spec.py", rewrote: true}},
		{"directory", "sub/", "dir", target{dest: "/p/dir/sub/", content: "dir/sub", rewrote: true}},
		{"uppercase extension", "A.MD", "", target{dest: "/p/A.MD", content: "A.MD", rewrote: true}},
		{"query string", "a.md?x=1", "", target{dest: "/p/a.md?x=1", content: "a.md", rewrote: true}},
		{"bare fragment", "#Общее", "dir", target{dest: "#Общее"}},
		{"empty", "", "dir", target{}},
		{"https", "https://ya.ru/x", "dir", target{dest: "https://ya.ru/x", external: true}},
		{"http", "http://ya.ru", "dir", target{dest: "http://ya.ru", external: true}},
		{"protocol relative", "//ya.ru/x", "dir", target{dest: "//ya.ru/x"}},
		{"mailto", "mailto:a@b.c", "dir", target{dest: "mailto:a@b.c"}},
		{"tel", "tel:+79990000000", "dir", target{dest: "tel:+79990000000"}},
		{"already an app route", "/p/a/b.md", "dir", target{dest: "/p/a/b.md"}},
		{"escapes the root", "../../../etc/passwd", "dir", target{dest: "#", broken: true}},
		{"escapes the root from the root", "../x.md", "", target{dest: "#", broken: true}},
		{"unparseable", "%zz.md", "dir", target{dest: "%zz.md", broken: true}},
	}
	tr := &linkTransformer{pagePrefix: defaultPagePrefix, rawPrefix: defaultRawPrefix}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, tr.resolve(tt.dest, tt.dir))
		})
	}
}

func TestResolveIsIdempotent(t *testing.T) {
	tr := &linkTransformer{pagePrefix: defaultPagePrefix, rawPrefix: defaultRawPrefix}
	for _, dest := range []string{"a/b.md", "./img.png", "https://ya.ru", "#Общее", "../c.md#раздел"} {
		t.Run(dest, func(t *testing.T) {
			once := tr.resolve(dest, "dir/sub")
			assert.Equal(t, once.dest, tr.resolve(once.dest, "dir/sub").dest)
		})
	}
}

func TestRenderLinkAttributes(t *testing.T) {
	tests := []struct {
		name, src string
		want      []string
		notWant   []string
	}{
		{
			name: "external link opens in a new tab",
			src:  "[x](https://ya.ru)",
			want: []string{`href="https://ya.ru"`, `target="_blank"`, `rel="noopener noreferrer nofollow"`},
		},
		{
			name: "autolink opens in a new tab",
			src:  "<https://ya.ru/путь>",
			want: []string{`target="_blank"`, `rel="noopener noreferrer nofollow"`},
		},
		{
			name:    "internal link is not nofollowed",
			src:     "[x](other.md)",
			want:    []string{`href="/p/dir/other.md"`},
			notWant: []string{"nofollow", "target="},
		},
		{
			name: "local image is lazy",
			src:  "![](pic.png)",
			want: []string{`src="/raw/dir/pic.png"`, `loading="lazy"`, `decoding="async"`},
		},
		{
			name:    "remote image is left alone",
			src:     "![](https://ya.ru/pic.png)",
			want:    []string{`src="https://ya.ru/pic.png"`},
			notWant: []string{"loading=", "decoding="},
		},
		{
			name: "escaping link is inert and marked",
			src:  "[x](../../etc/passwd)",
			want: []string{`class="broken"`},
		},
		{
			name: "cyrillic file name is percent-encoded",
			src:  "[x](файл.md)",
			want: []string{`href="/p/dir/%D1%84%D0%B0%D0%B9%D0%BB.md"`},
		},
		{
			name: "balanced parens survive in a fragment",
			src:  "[x](#Версионирование-(библиотек,-программ-и-т-д))",
			want: []string{`(%D0%B1%D0%B8%D0%B1%D0%BB%D0%B8%D0%BE%D1%82%D0%B5%D0%BA,`},
		},
		{
			name: "quotes in a fragment are escaped",
			src:  `[x](#Активация-"Quick-Search"-в-synaptic)`,
			want: []string{`%22Quick-Search%22`},
		},
	}
	r := New(Options{})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := r.RenderInline([]byte(tt.src), "dir/doc.md")
			require.NoError(t, err)
			for _, want := range tt.want {
				assert.Contains(t, string(out), want)
			}
			for _, notWant := range tt.notWant {
				assert.NotContains(t, string(out), notWant)
			}
		})
	}
}

func TestRenderBrokenLinks(t *testing.T) {
	// arrange
	r := New(Options{LinkExists: func(p string) bool { return !strings.Contains(p, "missing") }})

	// act
	out, err := r.RenderInline([]byte("[a](missing.md) [b](real.md) ![c](missing.png)"), "dir/doc.md")

	// assert
	require.NoError(t, err)
	assert.Equal(t,
		`<p><a href="/p/dir/missing.md" class="broken">a</a> <a href="/p/dir/real.md">b</a> `+
			`<img src="/raw/dir/missing.png" alt="c" loading="lazy" decoding="async" class="broken"></p>`+"\n",
		string(out))
}

func TestRenderCustomPrefixes(t *testing.T) {
	// arrange
	r := New(Options{PagePrefix: "/view/", RawPrefix: "/files/"})

	// act
	out, err := r.RenderInline([]byte("[a](x.md) ![b](y.png)"), "dir/doc.md")

	// assert
	require.NoError(t, err)
	assert.Contains(t, string(out), `href="/view/dir/x.md"`)
	assert.Contains(t, string(out), `src="/files/dir/y.png"`)
}

func TestRenderRewritesRawHTMLLinks(t *testing.T) {
	// arrange
	src := "<div class=\"note\">\n\n<img src=\"./схема.png\">\n<a href=\"other.md\">текст</a>\n<a href=\"https://ya.ru\">внешняя</a>\n\n</div>\n"

	// act
	out, err := New(Options{}).RenderInline([]byte(src), "dir/doc.md")

	// assert
	require.NoError(t, err)
	assert.Contains(t, string(out), `src="/raw/dir/%D1%81%D1%85%D0%B5%D0%BC%D0%B0.png"`)
	assert.Contains(t, string(out), `loading="lazy"`)
	assert.Contains(t, string(out), `href="/p/dir/other.md"`)
	assert.Contains(t, string(out), `href="https://ya.ru"`)
}
