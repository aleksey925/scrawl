package format

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
)

const MaxSize = 256 << 10

const WorkerEnv = "SCRAWL_FORMAT_WORKER"

var ErrTooLarge = errors.New("note is too large to format")

type request struct {
	Text string `json:"text"`
}

type response struct {
	Text  string `json:"text"`
	Error string `json:"error,omitempty"`
}

type Formatter struct {
	free chan struct{}

	mu     sync.Mutex
	idle   []*worker
	closed bool
}

func New(workers int) *Formatter {
	f := &Formatter{free: make(chan struct{}, workers)}
	for range workers {
		f.free <- struct{}{}
		f.idle = append(f.idle, &worker{})
	}
	return f
}

func (f *Formatter) Markdown(ctx context.Context, text string) (string, error) {
	if len(text) > MaxSize {
		return "", fmt.Errorf("format %d bytes: %w", len(text), ErrTooLarge)
	}

	select {
	case <-f.free:
	case <-ctx.Done():
		return "", fmt.Errorf("wait for a formatter: %w", ctx.Err())
	}
	wrk, err := f.take()
	if err != nil {
		f.free <- struct{}{}
		return "", err
	}
	defer func() {
		f.put(wrk)
		f.free <- struct{}{}
	}()

	if wrk.cmd == nil {
		if startErr := wrk.start(); startErr != nil {
			return "", startErr
		}
	}

	type outcome struct {
		res response
		err error
	}
	done := make(chan outcome, 1)
	go func() {
		res, askErr := wrk.ask(request{Text: text})
		done <- outcome{res: res, err: askErr}
	}()

	select {
	case out := <-done:
		if out.err != nil {
			wrk.stop()
			return "", out.err
		}
		if out.res.Error != "" {
			return "", fmt.Errorf("prettier: %s", out.res.Error)
		}
		return out.res.Text, nil
	case <-ctx.Done():
		wrk.stop()
		<-done
		return "", fmt.Errorf("format: %w", ctx.Err())
	}
}

func (f *Formatter) take() (*worker, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return nil, errors.New("the formatter is closed")
	}
	wrk := f.idle[len(f.idle)-1]
	f.idle = f.idle[:len(f.idle)-1]
	return wrk, nil
}

func (f *Formatter) put(wrk *worker) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		wrk.stop()
		return
	}
	f.idle = append(f.idle, wrk)
}

func (f *Formatter) Close() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
	for _, wrk := range f.idle {
		wrk.stop()
	}
	f.idle = nil
}

type worker struct {
	cmd   *exec.Cmd
	stdin io.WriteCloser
	enc   *json.Encoder
	dec   *json.Decoder
}

func (w *worker) start() error {
	self, err := os.Executable()
	if err != nil {
		return fmt.Errorf("find the binary to start a formatter from: %w", err)
	}
	//nolint:gosec,noctx // our own binary with no arguments, and a worker outlives the call that started it
	cmd := exec.Command(self)
	cmd.Env = append(os.Environ(), WorkerEnv+"=1")
	cmd.Stderr = os.Stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("start a formatter: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("start a formatter: %w", err)
	}
	if err = cmd.Start(); err != nil {
		return fmt.Errorf("start a formatter: %w", err)
	}
	w.cmd, w.stdin = cmd, stdin
	w.enc, w.dec = json.NewEncoder(stdin), json.NewDecoder(stdout)
	return nil
}

func (w *worker) ask(req request) (response, error) {
	if err := w.enc.Encode(req); err != nil {
		return response{}, fmt.Errorf("send the note to the formatter: %w", err)
	}
	var res response
	if err := w.dec.Decode(&res); err != nil {
		return response{}, fmt.Errorf("read what the formatter answered: %w", err)
	}
	return res, nil
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
