package server

import (
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/aleksey925/scrawl/render"
)

func TestPageCacheGetPut(t *testing.T) {
	// arrange
	cache := newPageCache(10, 0)
	page := render.Result{HTML: "<p>hi</p>", Title: "Hi", TOC: []render.Heading{{Level: 2, Text: "Hi", ID: "hi"}}}

	// act
	cache.put(testProject, "a/b.md", "sha256:one", page)

	// assert
	got, ok := cache.get(testProject, "a/b.md", "sha256:one")
	assert.True(t, ok)
	assert.Equal(t, page, got)
	assert.Equal(t, 1, cache.len())
}

func TestPageCacheMisses(t *testing.T) {
	// arrange
	cache := newPageCache(10, 0)
	cache.put(testProject, "a/b.md", "sha256:one", render.Result{HTML: "<p>old</p>"})

	tests := []struct {
		name string
		path string
		rev  string
	}{
		{name: "another revision", path: "a/b.md", rev: "sha256:two"},
		{name: "another path", path: "a/c.md", rev: "sha256:one"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			_, ok := cache.get(testProject, tc.path, tc.rev)

			// assert
			assert.False(t, ok)
		})
	}
}

func TestPageCacheReplacesSameKey(t *testing.T) {
	// arrange
	cache := newPageCache(10, 0)
	cache.put(testProject, "a/b.md", "sha256:one", render.Result{HTML: "<p>old</p>"})

	// act
	cache.put(testProject, "a/b.md", "sha256:one", render.Result{HTML: "<p>new</p>"})

	// assert
	got, ok := cache.get(testProject, "a/b.md", "sha256:one")
	assert.True(t, ok)
	assert.Equal(t, render.Result{HTML: "<p>new</p>"}, got)
	assert.Equal(t, 1, cache.len())
}

func TestPageCacheInvalidateDropsEveryRevision(t *testing.T) {
	// arrange
	cache := newPageCache(10, 0)
	cache.put(testProject, "a/b.md", "sha256:one", render.Result{HTML: "<p>one</p>"})
	cache.put(testProject, "a/b.md", "sha256:two", render.Result{HTML: "<p>two</p>"})
	cache.put(testProject, "a/c.md", "sha256:one", render.Result{HTML: "<p>other</p>"})

	// act
	cache.invalidate(testProject, "a/b.md")

	// assert
	_, first := cache.get(testProject, "a/b.md", "sha256:one")
	_, second := cache.get(testProject, "a/b.md", "sha256:two")
	_, kept := cache.get(testProject, "a/c.md", "sha256:one")
	assert.False(t, first)
	assert.False(t, second)
	assert.True(t, kept)
	assert.Equal(t, 1, cache.len())
}

func TestPageCacheEvictsLeastRecentlyUsed(t *testing.T) {
	// arrange
	cache := newPageCache(2, 0)
	cache.put(testProject, "first.md", "rev", render.Result{HTML: "<p>1</p>"})
	cache.put(testProject, "second.md", "rev", render.Result{HTML: "<p>2</p>"})

	// act
	cache.get(testProject, "first.md", "rev") // first is now the most recently used
	cache.put(testProject, "third.md", "rev", render.Result{HTML: "<p>3</p>"})

	// assert
	_, first := cache.get(testProject, "first.md", "rev")
	_, second := cache.get(testProject, "second.md", "rev")
	_, third := cache.get(testProject, "third.md", "rev")
	assert.True(t, first)
	assert.False(t, second)
	assert.True(t, third)
	assert.Equal(t, 2, cache.len())
}

func TestPageCacheEvictsOnBytes(t *testing.T) {
	// arrange
	cache := newPageCache(0, 20)

	// act
	for i := range 5 {
		cache.put(testProject, "doc"+strconv.Itoa(i)+".md", "rev", render.Result{HTML: "0123456789"})
	}

	// assert
	assert.Equal(t, 2, cache.len())
}

func TestPageCacheNil(t *testing.T) {
	// arrange
	var cache *pageCache

	// act & assert
	assert.NotPanics(t, func() {
		cache.put(testProject, "a.md", "rev", render.Result{})
		cache.invalidate(testProject, "a.md")
	})
	_, ok := cache.get(testProject, "a.md", "rev")
	assert.False(t, ok)
	assert.Equal(t, 0, cache.len())
}
