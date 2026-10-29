package workerpool

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
)

type Pool[Req, Res any] struct {
	name string
	env  string
	free chan struct{}

	mu     sync.Mutex
	idle   []*worker
	closed bool
}

func New[Req, Res any](name, env string, workers int) *Pool[Req, Res] {
	p := &Pool[Req, Res]{name: name, env: env, free: make(chan struct{}, workers)}
	for range workers {
		p.free <- struct{}{}
		p.idle = append(p.idle, &worker{})
	}
	return p
}

func (p *Pool[Req, Res]) Ask(ctx context.Context, req Req) (Res, error) {
	var zero Res
	select {
	case <-p.free:
	case <-ctx.Done():
		return zero, fmt.Errorf("wait for a %s: %w", p.name, ctx.Err())
	}
	wrk, err := p.take()
	if err != nil {
		p.free <- struct{}{}
		return zero, err
	}
	defer func() {
		p.put(wrk)
		p.free <- struct{}{}
	}()

	if wrk.cmd == nil {
		if startErr := wrk.start(p.name, p.env); startErr != nil {
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
		askErr := wrk.ask(p.name, req, &res)
		done <- outcome{res: res, err: askErr}
	}()

	select {
	case out := <-done:
		if out.err != nil {
			wrk.stop()
			return zero, out.err
		}
		return out.res, nil
	case <-ctx.Done():
		wrk.stop()
		<-done
		return zero, fmt.Errorf("%s: %w", p.name, ctx.Err())
	}
}

func (p *Pool[Req, Res]) take() (*worker, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil, fmt.Errorf("the %s is closed", p.name)
	}
	wrk := p.idle[len(p.idle)-1]
	p.idle = p.idle[:len(p.idle)-1]
	return wrk, nil
}

func (p *Pool[Req, Res]) put(wrk *worker) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		wrk.stop()
		return
	}
	p.idle = append(p.idle, wrk)
}

func (p *Pool[Req, Res]) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	for _, wrk := range p.idle {
		wrk.stop()
	}
	p.idle = nil
}

type worker struct {
	cmd   *exec.Cmd
	stdin io.WriteCloser
	enc   *json.Encoder
	dec   *json.Decoder
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
	if w.cmd == nil {
		return
	}
	_ = w.stdin.Close()
	_ = w.cmd.Process.Kill()
	_ = w.cmd.Wait()
	w.cmd = nil
}
