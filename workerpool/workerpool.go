package workerpool

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"
)

type Options struct {
	Name    string
	Env     string
	Workers int
	Limit   time.Duration
	Idle    time.Duration
	Detach  bool
}

var ErrOverLimit = fmt.Errorf("ran past its time limit: %w", context.DeadlineExceeded)

type WaitError struct {
	Name string
	Err  error
}

func (e *WaitError) Error() string {
	return fmt.Sprintf("wait for a %s: %v", e.Name, e.Err)
}

func (e *WaitError) Unwrap() error {
	return e.Err
}

type Retiring interface {
	Retiring() bool
}

type Pool[Req, Res any] struct {
	opts  Options
	free  chan *worker
	life  context.Context
	end   context.CancelCauseFunc
	ended error
	runs  sync.WaitGroup

	mu sync.Mutex
}

func New[Req, Res any](opts Options) *Pool[Req, Res] {
	life, end := context.WithCancelCause(context.Background())
	p := &Pool[Req, Res]{
		opts: opts, free: make(chan *worker, opts.Workers),
		life: life, end: end, ended: fmt.Errorf("the %s is closed", opts.Name),
	}
	for range opts.Workers {
		p.free <- &worker{}
	}
	return p
}

func RunIfAsked(env, name string, serve func(in io.Reader, out io.Writer) error) {
	if os.Getenv(env) == "" {
		return
	}
	if err := serve(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "%s: %v\n", name, err)
		os.Exit(1)
	}
	os.Exit(0)
}

func (p *Pool[Req, Res]) Ask(ctx context.Context, req Req) (Res, error) {
	var zero Res
	wrk, err := p.take(ctx)
	if err != nil {
		return zero, err
	}
	defer p.put(wrk)
	if p.opts.Detach {
		var stop context.CancelCauseFunc
		ctx, stop = context.WithCancelCause(context.WithoutCancel(ctx))
		defer stop(nil)
		defer context.AfterFunc(p.life, func() { stop(p.ended) })() //nolint:contextcheck // a detached call ends with the pool, not its caller
	}
	if p.opts.Limit > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeoutCause(ctx, p.opts.Limit, ErrOverLimit)
		defer cancel()
	}
	if wrk.cmd == nil {
		if startErr := wrk.start(p.opts.Name, p.opts.Env); startErr != nil {
			return zero, startErr
		}
	}

	type outcome struct {
		res Res
		err error
	}
	done := make(chan outcome, 1)
	go func() {
		var res Res
		askErr := wrk.ask(p.opts.Name, req, &res)
		done <- outcome{res: res, err: askErr}
	}()

	select {
	case out := <-done:
		if out.err != nil {
			wrk.stop()
			return zero, out.err
		}
		if retiring, ok := any(out.res).(Retiring); ok && retiring.Retiring() {
			wrk.stop()
		}
		return out.res, nil
	case <-ctx.Done():
		wrk.stop()
		<-done
		return zero, fmt.Errorf("%s: %w", p.opts.Name, context.Cause(ctx))
	}
}

func (p *Pool[Req, Res]) take(ctx context.Context) (*worker, error) {
	if err := ctx.Err(); err != nil {
		return nil, &WaitError{Name: p.opts.Name, Err: err}
	}
	select {
	case wrk := <-p.free:
		return p.lend(wrk)
	case <-p.life.Done():
		return nil, p.ended
	case <-ctx.Done():
		return nil, &WaitError{Name: p.opts.Name, Err: ctx.Err()}
	}
}

func (p *Pool[Req, Res]) lend(wrk *worker) (*worker, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.life.Err() != nil {
		wrk.stop()
		return nil, p.ended
	}
	if p.opts.Detach {
		p.runs.Add(1)
	}
	wrk.claim()
	return wrk, nil
}

func (p *Pool[Req, Res]) put(wrk *worker) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.opts.Detach {
		defer p.runs.Done()
	}
	if p.life.Err() != nil {
		wrk.stop()
		return
	}
	wrk.release(p.opts.Idle)
	p.free <- wrk
}

func (p *Pool[Req, Res]) Close() {
	p.stopFree()
	p.runs.Wait()
}

func (p *Pool[Req, Res]) stopFree() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.life.Err() != nil {
		return
	}
	p.end(p.ended)
	for {
		select {
		case wrk := <-p.free:
			wrk.stop()
		default:
			return
		}
	}
}

type worker struct {
	mu    sync.Mutex
	busy  bool
	freed time.Time
	timer *time.Timer

	cmd   *exec.Cmd
	stdin io.WriteCloser
	enc   *json.Encoder
	dec   *json.Decoder
}

func (w *worker) claim() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.busy = true
}

func (w *worker) release(idle time.Duration) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.busy, w.freed = false, time.Now()
	if idle <= 0 || w.cmd == nil {
		return
	}
	if w.timer == nil {
		w.timer = time.AfterFunc(idle, func() { w.stopIdle(idle) })
		return
	}
	w.timer.Reset(idle)
}

func (w *worker) stopIdle(idle time.Duration) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.busy && time.Since(w.freed) >= idle {
		w.stopLocked()
	}
}

func (w *worker) start(name, env string) error {
	self, err := os.Executable()
	if err != nil {
		return fmt.Errorf("find the binary to start a %s from: %w", name, err)
	}
	//nolint:gosec,noctx // our own binary with no arguments, and a worker outlives the call that started it
	cmd := exec.Command(self)
	cmd.Env = append(os.Environ(), env+"=1")
	cmd.Stderr = os.Stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("start a %s: %w", name, err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("start a %s: %w", name, err)
	}
	if err = cmd.Start(); err != nil {
		return fmt.Errorf("start a %s: %w", name, err)
	}
	w.cmd, w.stdin = cmd, stdin
	w.enc, w.dec = json.NewEncoder(stdin), json.NewDecoder(stdout)
	return nil
}

func (w *worker) ask(name string, req, res any) error {
	if err := w.enc.Encode(req); err != nil {
		return fmt.Errorf("send the request to the %s: %w", name, err)
	}
	if err := w.dec.Decode(res); err != nil {
		return fmt.Errorf("read what the %s answered: %w", name, err)
	}
	return nil
}

func (w *worker) stop() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.stopLocked()
}

func (w *worker) stopLocked() {
	if w.cmd == nil {
		return
	}
	_ = w.stdin.Close()
	_ = w.cmd.Process.Kill()
	_ = w.cmd.Wait()
	w.cmd = nil
}
