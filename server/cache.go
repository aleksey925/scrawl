package server

import (
	"container/list"
	"sync"

	"github.com/aleksey925/scrawl/render"
)

type pageCache struct {
	mu         sync.Mutex
	maxEntries int
	maxBytes   int64

	bytes  int64
	order  *list.List
	byPath map[pageKey]map[string]*list.Element
}

type pageKey struct {
	space string
	path  string
}

type pageEntry struct {
	key  pageKey
	rev  string
	res  render.Result
	size int64
}

func newPageCache(maxEntries int, maxBytes int64) *pageCache {
	return &pageCache{
		maxEntries: maxEntries,
		maxBytes:   maxBytes,
		order:      list.New(),
		byPath:     map[pageKey]map[string]*list.Element{},
	}
}

func (c *pageCache) get(space, path, rev string) (render.Result, bool) {
	if c == nil {
		return render.Result{}, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	el, ok := c.byPath[pageKey{space, path}][rev]
	if !ok {
		return render.Result{}, false
	}
	c.order.MoveToFront(el)
	return el.Value.(*pageEntry).res, true
}

func (c *pageCache) put(space, path, rev string, res render.Result) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	key := pageKey{space, path}
	if el, ok := c.byPath[key][rev]; ok {
		c.drop(el)
	}
	entry := &pageEntry{key: key, rev: rev, res: res, size: resultSize(res)}
	el := c.order.PushFront(entry)
	revs, ok := c.byPath[key]
	if !ok {
		revs = map[string]*list.Element{}
		c.byPath[key] = revs
	}
	revs[rev] = el
	c.bytes += entry.size

	for c.overflows() {
		back := c.order.Back()
		if back == nil {
			return
		}
		c.drop(back)
	}
}

func (c *pageCache) invalidate(space, path string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	for _, el := range c.byPath[pageKey{space, path}] {
		c.drop(el)
	}
}

func (c *pageCache) len() int {
	if c == nil {
		return 0
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.order.Len()
}

func (c *pageCache) overflows() bool {
	if c.maxEntries > 0 && c.order.Len() > c.maxEntries {
		return true
	}
	return c.maxBytes > 0 && c.bytes > c.maxBytes
}

func (c *pageCache) drop(el *list.Element) {
	entry := el.Value.(*pageEntry)
	c.order.Remove(el)
	c.bytes -= entry.size

	revs := c.byPath[entry.key]
	delete(revs, entry.rev)
	if len(revs) == 0 {
		delete(c.byPath, entry.key)
	}
}

func resultSize(res render.Result) int64 {
	size := int64(len(res.HTML)) + int64(len(res.Title))
	for _, h := range res.TOC {
		size += int64(len(h.Text) + len(h.ID))
	}
	return size
}
