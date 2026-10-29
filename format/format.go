package format

import (
	"context"
	"errors"
	"fmt"

	"github.com/aleksey925/scrawl/workerpool"
)

const MaxSize = 256 << 10

const WorkerEnv = "SCRAWL_FORMAT_WORKER"

const workerName = "format worker"

var ErrTooLarge = errors.New("note is too large to format")

type request struct {
	Text string `json:"text"`
}

type response struct {
	Text  string `json:"text"`
	Error string `json:"error,omitempty"`
}

type Formatter struct {
	pool *workerpool.Pool[request, response]
}

func New(workers int) *Formatter {
	return &Formatter{pool: workerpool.New[request, response](workerpool.Options{Name: workerName, Env: WorkerEnv, Workers: workers})}
}

func (f *Formatter) Markdown(ctx context.Context, text string) (string, error) {
	if len(text) > MaxSize {
		return "", fmt.Errorf("format %d bytes: %w", len(text), ErrTooLarge)
	}
	res, err := f.pool.Ask(ctx, request{Text: text})
	if err != nil {
		return "", err
	}
	if res.Error != "" {
		return "", fmt.Errorf("prettier: %s", res.Error)
	}
	return res.Text, nil
}

func (f *Formatter) Close() {
	f.pool.Close()
}
