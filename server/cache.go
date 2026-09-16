package server

import (
	"container/list"
	"sync"

	"github.com/aleksey925/scrawl/render"
)

// pageCache is a bounded LRU of rendered documents, shared by every project.
//
// The key is the project plus the content path plus the revision of the source,
// so a stale entry can never be served: a changed file hashes to a different
// revision and simply misses. The project is part of it because a content path
// is relative to its own root, so two projects name the same document. The
// watcher still drops entries by path, otherwise a deleted or renamed document
// would hold its HTML until it was evicted.
//
// One cache rather than one per project, so the byte bound an operator reasons
// about stays one number instead of being divided by however many projects the
// deployment happens to have.
//
// Both bounds are honored at once, and either can be disabled with a zero.
type pageCache struct {
	mu         sync.Mutex
	maxEntries int
	maxBytes   int64

	bytes  int64
	order  *list.List // *pageEntry, most recently used at the front
	byPath map[pageKey]map[string]*list.Element
}

// pageKey names one document of one project.
type pageKey struct {
	project string
	path    string
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

// get returns the rendered document for a revision of a path.
func (c *pageCache) get(project, path, rev string) (render.Result, bool) {
	if c == nil {
		return render.Result{}, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	el, ok := c.byPath[pageKey{project, path}][rev]
	if !ok {
		return render.Result{}, false
	}
	c.order.MoveToFront(el)
	return el.Value.(*pageEntry).res, true
}

// put stores a rendered document, evicting the least recently used entries
// until both bounds hold again.
func (c *pageCache) put(project, path, rev string, res render.Result) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	key := pageKey{project, path}
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

// invalidate forgets every revision of a path of one project.
func (c *pageCache) invalidate(project, path string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	for _, el := range c.byPath[pageKey{project, path}] {
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

	revs := c.byPath[entry.key]
	delete(revs, entry.rev)
	if len(revs) == 0 {
		delete(c.byPath, entry.key)
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
