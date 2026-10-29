package plantuml

import (
	"container/list"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"regexp"
	"sync"

	"github.com/aleksey925/scrawl/workerpool"
)

const WorkerEnv = "SCRAWL_PLANTUML_WORKER"

const MaxSource = 256 << 10

const (
	cacheEntries = 512
	cacheBytes   = 32 << 20
)

var ErrTooLarge = errors.New("diagram is too large to render")

var startLine = regexp.MustCompile(`(?m)^\s*@start`)

type request struct {
	Source string `json:"source"`
}

type response struct {
	SVG   string `json:"svg,omitempty"`
	Error string `json:"error,omitempty"`
	Line  int    `json:"line,omitempty"`
}

type DiagramError struct {
	Line    int
	Message string
}

func (e *DiagramError) Error() string {
	if e.Line > 0 {
		return fmt.Sprintf("line %d: %s", e.Line, e.Message)
	}
	return e.Message
}

type Renderer struct {
	pool  *workerpool.Pool[request, response]
	cache *cache
}

func New(workers int) *Renderer {
	return &Renderer{
		pool:  workerpool.New[request, response]("plantuml renderer", WorkerEnv, workers),
		cache: newCache(cacheEntries, cacheBytes),
	}
}

func (r *Renderer) SVG(ctx context.Context, source string) (string, error) {
	if len(source) > MaxSource {
		return "", fmt.Errorf("render %d bytes: %w", len(source), ErrTooLarge)
	}
	diagram, added := withStart(source)
	key := sha256.Sum256([]byte(diagram))
	res, ok := r.cache.get(key)
	if !ok {
		var err error
		if res, err = r.pool.Ask(ctx, request{Source: diagram}); err != nil {
			return "", err
		}
		r.cache.put(key, res)
	}
	if res.Error != "" {
		return "", &DiagramError{Line: max(res.Line-added, 0), Message: res.Error}
	}
	return res.SVG, nil
}

func withStart(source string) (string, int) {
	if startLine.MatchString(source) {
		return source, 0
	}
	return "@startuml\n" + source + "\n@enduml\n", 1
}

func (r *Renderer) Close() {
	r.pool.Close()
}

type cache struct {
	mu         sync.Mutex
	order      *list.List
	entries    map[[sha256.Size]byte]*list.Element
	maxEntries int
	maxBytes   int
	bytes      int
}

type cached struct {
	key [sha256.Size]byte
	res response
}

func newCache(maxEntries, maxBytes int) *cache {
	return &cache{
		order:      list.New(),
		entries:    map[[sha256.Size]byte]*list.Element{},
		maxEntries: maxEntries,
		maxBytes:   maxBytes,
	}
}

func sizeOf(res response) int {
	return len(res.SVG) + len(res.Error)
}

func (c *cache) get(key [sha256.Size]byte) (response, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.entries[key]
	if !ok {
		return response{}, false
	}
	c.order.MoveToFront(el)
	return el.Value.(*cached).res, true
}

func (c *cache) put(key [sha256.Size]byte, res response) {
	if sizeOf(res) > c.maxBytes {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.entries[key]; ok {
		c.bytes -= sizeOf(el.Value.(*cached).res)
		el.Value.(*cached).res = res
		c.bytes += sizeOf(res)
		c.order.MoveToFront(el)
	} else {
		c.entries[key] = c.order.PushFront(&cached{key: key, res: res})
		c.bytes += sizeOf(res)
	}
	for c.order.Len() > c.maxEntries || c.bytes > c.maxBytes {
		oldest := c.order.Back()
		entry := oldest.Value.(*cached)
		c.order.Remove(oldest)
		delete(c.entries, entry.key)
		c.bytes -= sizeOf(entry.res)
	}
}
