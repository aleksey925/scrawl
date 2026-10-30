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

const workers = 1

const (
	diagramTimeout = 2 * time.Minute
	idleTimeout    = 2 * time.Minute
)

const (
	cacheEntries = 512
	cacheBytes   = 32 << 20
)

var errTooLarge = errors.New("diagram is too large to render")

const tooSlow = "the server's PlantUML engine did not finish this diagram in time"

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

type asker interface {
	Ask(ctx context.Context, req request) (response, error)
	Close()
}

type Renderer struct {
	pool  asker
	cache *cache

	mu       sync.Mutex
	inFlight map[[sha256.Size]byte]*drawing
}

type drawing struct {
	done      chan struct{}
	res       response
	err       error
	abandoned bool
}

func New() *Renderer {
	return newRenderer(newPool(diagramTimeout))
}

func newPool(limit time.Duration) *workerpool.Pool[request, response] {
	return workerpool.New[request, response](workerpool.Options{
		Name: workerName, Env: workerEnv, Workers: workers, Limit: limit, Idle: idleTimeout, Detach: true,
	})
}

func newRenderer(pool asker) *Renderer {
	return &Renderer{
		pool:     pool,
		cache:    newCache(cacheEntries, cacheBytes),
		inFlight: map[[sha256.Size]byte]*drawing{},
	}
}

func (r *Renderer) svg(ctx context.Context, source string) (string, error) {
	if len(source) > maxSource {
		return "", fmt.Errorf("render %d bytes: %w", len(source), errTooLarge)
	}
	diagram, added := withStart(source)
	res, err := r.draw(ctx, diagram)
	if err != nil {
		return "", err
	}
	if res.Error != "" {
		return "", &diagramError{Line: max(res.Line-added, 0), Message: res.Error}
	}
	return res.SVG, nil
}

func (r *Renderer) draw(ctx context.Context, diagram string) (response, error) {
	key := sha256.Sum256([]byte(diagram))
	for {
		r.mu.Lock()
		if res, ok := r.cache.get(key); ok {
			r.mu.Unlock()
			return res, nil
		}
		if err := ctx.Err(); err != nil {
			r.mu.Unlock()
			return response{}, waitFailed(err)
		}
		run, busy := r.inFlight[key]
		if !busy {
			run = &drawing{done: make(chan struct{})}
			r.inFlight[key] = run
			r.mu.Unlock()
			go r.drawOnce(ctx, key, diagram, run)
		} else {
			r.mu.Unlock()
		}
		select {
		case <-run.done:
			if !run.abandoned {
				return run.res, run.err
			}
		case <-ctx.Done():
			return response{}, waitFailed(ctx.Err())
		}
	}
}

func waitFailed(err error) error {
	return fmt.Errorf("wait for the diagram to be drawn: %w", err)
}

func (r *Renderer) drawOnce(ctx context.Context, key [sha256.Size]byte, diagram string, run *drawing) {
	run.res, run.err = r.pool.Ask(ctx, request{Source: diagram})
	if errors.Is(run.err, workerpool.ErrOverLimit) {
		run.res, run.err = response{Error: tooSlow}, nil
	}
	var waiting *workerpool.WaitError
	run.abandoned = errors.As(run.err, &waiting)
	r.mu.Lock()
	if run.err == nil {
		r.cache.put(key, run.res)
	}
	delete(r.inFlight, key)
	r.mu.Unlock()
	close(run.done)
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
