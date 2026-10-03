package render

import (
	"strings"
	"testing"
)

func FuzzRender(f *testing.F) {
	seeds := []string{
		"",
		"# Заголовок\n",
		"Заголовок\n=========\n",
		"---\ntitle: x\n---\n# a\n",
		"<a name='Общее'></a>\n## Общее\n",
		"1. <h3>[Принципы](#Принципы)</h3>\n",
		"<details markdown=\"span\">\n<summary>S</summary>\nвнутри\n</details>\n",
		"```с\nint x;\n```  \n",
		"| a | b |\n|:-:|--:|\n| 1 | 2 |\n",
		"Абзац.\n3. Третий\n",
		"[x](../../../etc/passwd)\n",
		"![](./схема.png)\n",
		"<https://ya.ru/путь#:~:text=a%20(b),c&d=e>\n",
		"<script>alert(1)</script>\n",
		"    отступ\n\n\ttab\n",
		"- [ ] task\n- [x] done\n",
		"~~~\ntilde fence\n~~~\n",
		"#\n##\n###\n",
	}
	for _, seed := range seeds {
		f.Add(seed, "dir/doc.md")
	}
	r := New(Options{LinkExists: func(p string) bool { return strings.Contains(p, "yes") }})
	f.Fuzz(func(t *testing.T, src, docPath string) {
		res, err := r.Render([]byte(src), docPath)
		if err != nil {
			t.Fatalf("render: %v", err)
		}
		if _, err := r.RenderInline([]byte(src), docPath); err != nil {
			t.Fatalf("render inline: %v", err)
		}
		for _, h := range res.TOC {
			if h.Level < 1 || h.Level > tocMaxLevel {
				t.Fatalf("heading level out of range: %d", h.Level)
			}
		}
	})
}
