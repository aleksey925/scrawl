package plantuml

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"runtime/debug"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
	"github.com/tetratelabs/wazero/sys"

	"github.com/aleksey925/scrawl/gzassets"
	"github.com/aleksey925/scrawl/workerpool"
)

const engineFile = "engine.wasm"

const (
	memoryPages = 16384
	retireBytes = 256 << 20
)

type engineMessage struct {
	Need string `json:"need,omitempty"`
	response
}

type libraryReply struct {
	Code  string `json:"code,omitempty"`
	Error string `json:"error,omitempty"`
}

func RunWorkerIfAsked() {
	workerpool.RunIfAsked(workerEnv, "plantuml worker", func(in io.Reader, out io.Writer) error {
		return serve(in, out, retireBytes)
	})
}

func serve(in io.Reader, out io.Writer, retireAt uint32) error {
	wasm, err := gzassets.Sub(engineFiles, engineDir).ReadFile(engineFile)
	if err != nil {
		return fmt.Errorf("read the engine: %w", err)
	}
	ctx := context.Background()
	cfg := wazero.NewRuntimeConfig().WithMemoryLimitPages(memoryPages).WithMemoryCapacityFromMax(true)
	runtime := wazero.NewRuntimeWithConfig(ctx, cfg)
	defer runtime.Close(ctx)
	if _, err = wasi_snapshot_preview1.Instantiate(ctx, runtime); err != nil {
		return fmt.Errorf("set up wasi: %w", err)
	}
	module, err := runtime.CompileModule(ctx, wasm)
	if err != nil {
		return fmt.Errorf("compile the engine: %w", err)
	}
	eng, err := startEngine(ctx, runtime, module)
	if err != nil {
		return err
	}
	defer eng.stop()

	requests, answers := json.NewDecoder(in), newEncoder(out)
	for {
		var req request
		if err = requests.Decode(&req); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return fmt.Errorf("read a request: %w", err)
		}
		res, renderErr := eng.render(req)
		if renderErr != nil {
			return renderErr
		}
		res.Retire = eng.memory() > retireAt
		if err = answers.Encode(res); err != nil {
			return fmt.Errorf("write an answer: %w", err)
		}
		if res.Retire {
			return nil
		}
		debug.FreeOSMemory()
	}
}

func newEncoder(w io.Writer) *json.Encoder {
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	return enc
}

type engine struct {
	instance api.Module
	in       *io.PipeWriter
	enc      *json.Encoder
	dec      *json.Decoder
	exited   chan struct{}
}

func startEngine(ctx context.Context, runtime wazero.Runtime, module wazero.CompiledModule) (*engine, error) {
	toEngine, engineIn := io.Pipe()
	engineOut, fromEngine := io.Pipe()
	cfg := wazero.NewModuleConfig().WithName("").WithStartFunctions().
		WithStdin(toEngine).WithStdout(fromEngine).WithStderr(os.Stderr)
	instance, err := runtime.InstantiateModule(ctx, module, cfg)
	if err != nil {
		return nil, fmt.Errorf("start the engine: %w", err)
	}
	e := &engine{
		instance: instance,
		in:       engineIn,
		enc:      newEncoder(engineIn),
		dec:      json.NewDecoder(engineOut),
		exited:   make(chan struct{}),
	}
	go func() {
		defer close(e.exited)
		_, runErr := instance.ExportedFunction("_start").Call(ctx)
		var exit *sys.ExitError
		if errors.As(runErr, &exit) && exit.ExitCode() == 0 {
			runErr = nil
		}
		_ = instance.Close(ctx)
		_ = fromEngine.CloseWithError(errors.Join(runErr, io.ErrUnexpectedEOF))
	}()
	return e, nil
}

func (e *engine) memory() uint32 {
	return e.instance.Memory().Size()
}

func (e *engine) render(req request) (response, error) {
	if err := e.enc.Encode(req); err != nil {
		return response{}, fmt.Errorf("hand the diagram to the engine: %w", err)
	}
	for {
		var msg engineMessage
		if err := e.dec.Decode(&msg); err != nil {
			return response{}, fmt.Errorf("read what the engine answered: %w", err)
		}
		if msg.Need == "" {
			return msg.response, nil
		}
		if err := e.enc.Encode(libraryFor(msg.Need)); err != nil {
			return response{}, fmt.Errorf("hand %s to the engine: %w", msg.Need, err)
		}
	}
}

func (e *engine) stop() {
	_ = e.in.Close()
	<-e.exited
}

func libraryFor(name string) libraryReply {
	code, err := LibraryFile(name)
	if err != nil {
		return libraryReply{Error: err.Error()}
	}
	return libraryReply{Code: string(code)}
}
