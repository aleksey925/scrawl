package server

import (
	"container/list"
	"sync"

	"github.com/aleksey925/mdserver/render"
)

// pageCache is a bounded LRU of rendered documents.
//
// The key is the content path plus the revision of the source, so a stale
// entry can never be served: a changed file hashes to a different revision and
// simply misses. The watcher still drops entries by path, otherwise a deleted
// or renamed document would hold its HTML until it was evicted.
//
// Both bounds are honored at once, and either can be disabled with a zero.
type pageCache struct {
	mu         sync.Mutex
	maxEntries int
	maxBytes   int64

	bytes  int64
	order  *list.List // *pageEntry, most recently used at the front
	byPath map[string]map[string]*list.Element
}

type pageEntry struct {
	path string
	rev  string
	res  render.Result
	size int64
}

func newPageCache(maxEntries int, maxBytes int64) *pageCache {
	return &pageCache{
		maxEntries: maxEntries,
		maxBytes:   maxBytes,
		order:      list.New(),
		byPath:     map[string]map[string]*list.Element{},
	}
}

// get returns the rendered document for a revision of a path.
func (c *pageCache) get(path, rev string) (render.Result, bool) {
	if c == nil {
		return render.Result{}, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	el, ok := c.byPath[path][rev]
	if !ok {
		return render.Result{}, false
	}
	c.order.MoveToFront(el)
	return el.Value.(*pageEntry).res, true
}

// put stores a rendered document, evicting the least recently used entries
// until both bounds hold again.
func (c *pageCache) put(path, rev string, res render.Result) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	if el, ok := c.byPath[path][rev]; ok {
		c.drop(el)
	}
	entry := &pageEntry{path: path, rev: rev, res: res, size: resultSize(res)}
	el := c.order.PushFront(entry)
	revs, ok := c.byPath[path]
	if !ok {
		revs = map[string]*list.Element{}
		c.byPath[path] = revs
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

// invalidate forgets every revision of a path.
func (c *pageCache) invalidate(path string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	for _, el := range c.byPath[path] {
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

// drop removes one element, called with the lock held.
func (c *pageCache) drop(el *list.Element) {
	entry := el.Value.(*pageEntry)
	c.order.Remove(el)
	c.bytes -= entry.size

	revs := c.byPath[entry.path]
	delete(revs, entry.rev)
	if len(revs) == 0 {
		delete(c.byPath, entry.path)
	}
}

// resultSize estimates the memory one rendered document holds.
func resultSize(res render.Result) int64 {
	size := int64(len(res.HTML)) + int64(len(res.Title))
	for _, h := range res.TOC {
		size += int64(len(h.Text) + len(h.ID))
	}
	return size
}
