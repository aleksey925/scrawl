package render

import (
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/net/html"
)

// TestCorpus renders the real corpus and checks that every internal
// link and every in-page anchor still resolves. It is skipped unless
// SCRAWL_CORPUS points at a checkout:
//
//	SCRAWL_CORPUS=~/CodeProjects/knowledge-base go test ./render/ -run Corpus
func TestCorpus(t *testing.T) {
	root := corpusRoot(t)
	docs := corpusDocs(t, root)
	require.NotEmpty(t, docs)

	r := New(Options{LinkExists: func(p string) bool {
		_, err := os.Stat(filepath.Join(root, filepath.FromSlash(p)))
		return err == nil
	}})

	type page struct {
		anchors map[string]struct{}
		links   []string
	}
	pages := make(map[string]page, len(docs))
	headings := 0
	for _, doc := range docs {
		src, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(doc)))
		require.NoError(t, err)
		res, err := r.Render(src, doc)
		require.NoError(t, err, doc)
		require.NotEmpty(t, res.Title, doc)
		headings += len(res.TOC)
		anchors, links := collectHTML(t, string(res.HTML))
		pages[doc] = page{anchors: anchors, links: links}
	}

	var brokenLinks, missingAnchors []string
	inPage, internal := 0, 0
	for _, doc := range docs {
		for _, href := range pages[doc].links {
			targetPath, frag := splitFragment(href)
			switch {
			case strings.HasPrefix(href, "#"):
				inPage++
				if _, ok := pages[doc].anchors[frag]; !ok {
					missingAnchors = append(missingAnchors, doc+" -> "+href)
				}
			case strings.HasPrefix(href, defaultPagePrefix), strings.HasPrefix(href, defaultRawPrefix):
				internal++
				content := contentOf(targetPath)
				if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(content))); err != nil {
					brokenLinks = append(brokenLinks, doc+" -> "+href)
					continue
				}
				target, known := pages[content]
				if frag == "" || !known {
					continue
				}
				if _, ok := target.anchors[frag]; !ok {
					missingAnchors = append(missingAnchors, doc+" -> "+href)
				}
			}
		}
	}
	sort.Strings(brokenLinks)
	sort.Strings(missingAnchors)
	t.Logf("rendered %d documents, %d TOC headings", len(docs), headings)
	t.Logf("checked %d in-page anchors, %d internal links", inPage, internal)
	t.Logf("broken internal links: %d %v", len(brokenLinks), brokenLinks)
	t.Logf("missing anchors: %d %v", len(missingAnchors), missingAnchors)
	require.Empty(t, brokenLinks)
	require.Empty(t, missingAnchors)
}

func corpusRoot(t *testing.T) string {
	t.Helper()
	root := os.Getenv("SCRAWL_CORPUS")
	if root == "" {
		t.Skip("SCRAWL_CORPUS is not set")
	}
	if strings.HasPrefix(root, "~/") {
		home, err := os.UserHomeDir()
		require.NoError(t, err)
		root = filepath.Join(home, root[2:])
	}
	return root
}

func corpusDocs(t *testing.T, root string) []string {
	t.Helper()
	var docs []string
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if d.IsDir() {
			if strings.HasPrefix(name, ".") && p != root {
				return filepath.SkipDir
			}
			return nil
		}
		if filepath.Ext(name) != ".md" {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		require.NoError(t, err)
		docs = append(docs, filepath.ToSlash(rel))
		return nil
	})
	require.NoError(t, err)
	return docs
}

// collectHTML pulls every anchor target (an id anywhere, a name on an <a>) and
// every href out of a rendered document.
func collectHTML(t *testing.T, doc string) (anchors map[string]struct{}, links []string) {
	t.Helper()
	anchors = map[string]struct{}{}
	z := html.NewTokenizer(strings.NewReader(doc))
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			return anchors, links
		}
		if tt != html.StartTagToken && tt != html.SelfClosingTagToken {
			continue
		}
		tok := z.Token()
		for _, attr := range tok.Attr {
			switch {
			case attr.Key == "id", attr.Key == "name" && tok.Data == "a":
				anchors[attr.Val] = struct{}{}
			case attr.Key == "href" && tok.Data == "a":
				links = append(links, attr.Val)
			}
		}
	}
}

func splitFragment(href string) (dest, frag string) {
	dest, frag, _ = strings.Cut(href, "#")
	if decoded, err := url.PathUnescape(frag); err == nil {
		frag = decoded
	}
	return dest, frag
}

// contentOf turns an app route back into a content path.
func contentOf(route string) string {
	trimmed := strings.TrimPrefix(strings.TrimPrefix(route, defaultPagePrefix), defaultRawPrefix)
	if decoded, err := url.PathUnescape(trimmed); err == nil {
		trimmed = decoded
	}
	return path.Clean(strings.TrimSuffix(trimmed, "/"))
}
