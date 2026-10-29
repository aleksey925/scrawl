package plantuml

import (
	"container/list"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"regexp"
	"sync"
	"time"

	"github.com/aleksey925/scrawl/workerpool"
)

const (
	workerEnv  = "SCRAWL_PLANTUML_WORKER"
	workerName = "plantuml worker"
)

const maxSource = 256 << 10

const (
	diagramTimeout = 20 * time.Second
	idleTimeout    = 2 * time.Minute
)

const (
	cacheEntries = 512
	cacheBytes   = 32 << 20
)

var errTooLarge = errors.New("diagram is too large to render")

var startLine = regexp.MustCompile(`(?m)^\s*@start`)

type request struct {
	Source string `json:"source"`
}

type response struct {
	SVG    string `json:"svg,omitempty"`
	Error  string `json:"error,omitempty"`
	Line   int    `json:"line,omitempty"`
	Retire bool   `json:"retire,omitempty"`
}

func (r response) Retiring() bool {
	return r.Retire
}

type diagramError struct {
	Line    int
	Message string
}

func (e *diagramError) Error() string {
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
		pool: workerpool.New[request, response](workerpool.Options{
			Name: workerName, Env: workerEnv, Workers: workers, Limit: diagramTimeout, Idle: idleTimeout,
		}),
		cache: newCache(cacheEntries, cacheBytes),
	}
}

func (r *Renderer) svg(ctx context.Context, source string) (string, error) {
	if len(source) > maxSource {
		return "", fmt.Errorf("render %d bytes: %w", len(source), errTooLarge)
	}
	diagram, added := withStart(source)
	key := sha256.Sum256([]byte(diagram))
	res, ok := r.cache.get(key)
	if !ok {
		var err error
		if res, err = r.ask(ctx, diagram); err != nil {
			return "", err
		}
		r.cache.put(key, res)
	}
	if res.Error != "" {
		return "", &diagramError{Line: max(res.Line-added, 0), Message: res.Error}
	}
	return res.SVG, nil
}

func (r *Renderer) ask(ctx context.Context, diagram string) (response, error) {
	if err := ctx.Err(); err != nil {
		return response{}, fmt.Errorf("wait for a %s: %w", workerName, err)
	}
	run := context.WithoutCancel(ctx)
	if deadline, ok := ctx.Deadline(); ok {
		var cancel context.CancelFunc
		run, cancel = context.WithDeadline(run, deadline)
		defer cancel()
	}
	return r.pool.Ask(run, request{Source: diagram})
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
		c.order.MoveToFront(el)
		return
	}
	c.entries[key] = c.order.PushFront(&cached{key: key, res: res})
	c.bytes += sizeOf(res)
	for c.order.Len() > c.maxEntries || c.bytes > c.maxBytes {
		oldest := c.order.Back()
		entry := oldest.Value.(*cached)
		c.order.Remove(oldest)
		delete(c.entries, entry.key)
		c.bytes -= sizeOf(entry.res)
	}
}
