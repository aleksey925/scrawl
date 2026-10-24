package format

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"

	"github.com/aleksey925/scrawl/gzassets"
)

const wasmFile = "prettier.wasm"

const memoryPages = 4096

func RunWorkerIfAsked() {
	if os.Getenv(WorkerEnv) == "" {
		return
	}
	if err := serve(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "format worker: %v\n", err)
		os.Exit(1)
	}
	os.Exit(0)
}

func serve(in io.Reader, out io.Writer) error {
	wasm, err := gzassets.Sub(wasmFiles, wasmDir).ReadFile(wasmFile)
	if err != nil {
		return fmt.Errorf("read prettier: %w", err)
	}
	ctx := context.Background()
	runtime := wazero.NewRuntimeWithConfig(ctx, wazero.NewRuntimeConfig().WithMemoryLimitPages(memoryPages))
	defer runtime.Close(ctx)
	if _, err = wasi_snapshot_preview1.Instantiate(ctx, runtime); err != nil {
		return fmt.Errorf("set up wasi: %w", err)
	}
	module, err := runtime.CompileModule(ctx, wasm)
	if err != nil {
		return fmt.Errorf("compile prettier: %w", err)
	}

	dec, enc := json.NewDecoder(in), json.NewEncoder(out)
	for {
		var req request
		if err = dec.Decode(&req); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return fmt.Errorf("read a request: %w", err)
		}
		res, runErr := run(ctx, runtime, module, req)
		if runErr != nil {
			res = response{Error: runErr.Error()}
		}
		if err = enc.Encode(res); err != nil {
			return fmt.Errorf("write an answer: %w", err)
		}
	}
}

func run(ctx context.Context, runtime wazero.Runtime, module wazero.CompiledModule, req request) (response, error) {
	input, err := json.Marshal(req)
	if err != nil {
		return response{}, fmt.Errorf("encode the note: %w", err)
	}
	var stdout, stderr bytes.Buffer
	cfg := wazero.NewModuleConfig().WithName("").
		WithStdin(bytes.NewReader(input)).WithStdout(&stdout).WithStderr(&stderr)
	instance, err := runtime.InstantiateModule(ctx, module, cfg)
	if instance != nil {
		_ = instance.Close(ctx)
	}
	if err != nil {
		return response{}, fmt.Errorf("run prettier: %w: %s", err, bytes.TrimSpace(stderr.Bytes()))
	}

	var res response
	if err = json.Unmarshal(stdout.Bytes(), &res); err != nil {
		return response{}, fmt.Errorf("read what prettier answered: %w: %s", err, bytes.TrimSpace(stderr.Bytes()))
	}
	return res, nil
}
