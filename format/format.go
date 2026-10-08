// Package format formats markdown the way `prettier --write` does. It runs
// prettier itself: prettier.wasm holds it together with QuickJS, built by
// `make formatter`, and wazero executes that module with no cgo.
//
// The module runs in worker processes, copies of this binary started with
// WorkerEnv set, because nothing can stop it from inside: wazero only watches
// a context when every branch of the compiled code checks it, which made a run
// five times slower, and prettier is quadratic on some text. A process can be
// killed, so the deadline of a call is a real one.
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

// MaxSize caps what is worth formatting. QuickJS interprets prettier at about
// 30ms a kilobyte on ordinary prose, so a note at the cap takes many seconds.
const MaxSize = 256 << 10

// WorkerEnv marks a process as a worker. An environment variable and not an
// argument, so that a test binary, which owns its arguments, can be one too.
const WorkerEnv = "SCRAWL_FORMAT_WORKER"

// ErrTooLarge is a note above MaxSize.
var ErrTooLarge = errors.New("note is too large to format")

// Result is a formatted note. Cursor is where the offset passed in landed,
// counted the way javascript counts, in UTF-16 code units.
type Result struct {
	Text   string
	Cursor int
}

type request struct {
	Text   string `json:"text"`
	Cursor *int   `json:"cursor,omitempty"`
}

type response struct {
	Text   string `json:"text"`
	Cursor int    `json:"cursor"`
	Error  string `json:"error,omitempty"`
}

// Formatter runs prettier in a small pool of worker processes. A worker is
// started by the first call that needs one, so a server that never formats
// pays for none of it.
type Formatter struct {
	free chan struct{}

	mu     sync.Mutex
	idle   []*worker
	closed bool
}

// New makes a formatter that runs at most workers notes at a time.
func New(workers int) *Formatter {
	f := &Formatter{free: make(chan struct{}, workers)}
	for range workers {
		f.free <- struct{}{}
		f.idle = append(f.idle, &worker{})
	}
	return f
}

// Markdown formats one note. When ctx ends first the run is killed.
func (f *Formatter) Markdown(ctx context.Context, text string) (string, error) {
	res, err := f.format(ctx, request{Text: text})
	return res.Text, err
}

// MarkdownAt formats one note and says where the cursor of an editor ends up.
func (f *Formatter) MarkdownAt(ctx context.Context, text string, cursor int) (Result, error) {
	return f.format(ctx, request{Text: text, Cursor: &cursor})
}

func (f *Formatter) format(ctx context.Context, req request) (Result, error) {
	if len(req.Text) > MaxSize {
		return Result{}, fmt.Errorf("format %d bytes: %w", len(req.Text), ErrTooLarge)
	}

	select {
	case <-f.free:
	case <-ctx.Done():
		return Result{}, fmt.Errorf("wait for a formatter: %w", ctx.Err())
	}
	wrk, err := f.take()
	if err != nil {
		f.free <- struct{}{}
		return Result{}, err
	}
	defer func() {
		f.put(wrk)
		f.free <- struct{}{}
	}()

	type outcome struct {
		res response
		err error
	}
	done := make(chan outcome, 1)
	go func() {
		res, askErr := wrk.ask(req)
		done <- outcome{res: res, err: askErr}
	}()

	select {
	case out := <-done:
		if out.err != nil {
			wrk.stop()
			return Result{}, out.err
		}
		if out.res.Error != "" {
			return Result{}, fmt.Errorf("prettier: %s", out.res.Error)
		}
		return Result{Text: out.res.Text, Cursor: out.res.Cursor}, nil
	case <-ctx.Done():
		// killing the process is what ends the read the goroutine sits in
		wrk.stop()
		<-done
		return Result{}, fmt.Errorf("format: %w", ctx.Err())
	}
}

// take hands out the worker used last, so a quiet server keeps one process
// and not the whole pool.
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

// Close stops the workers. One that is busy is stopped when its call returns.
func (f *Formatter) Close() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
	for _, wrk := range f.idle {
		wrk.stop()
	}
	f.idle = nil
}

// worker is one process, started on first use and again after it was stopped.
// Only the call that took it from the pool touches it.
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
	if w.cmd == nil {
		if err := w.start(); err != nil {
			return response{}, err
		}
	}
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
