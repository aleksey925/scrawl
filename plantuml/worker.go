package plantuml

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"runtime/debug"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
	"github.com/tetratelabs/wazero/sys"

	"github.com/aleksey925/scrawl/gzassets"
)

const engineFile = "engine.wasm"

const (
	memoryPages  = 16384
	recycleBytes = 256 << 20
	idleTimeout  = 2 * time.Minute
)

type engineMessage struct {
	Need  string `json:"need,omitempty"`
	SVG   string `json:"svg,omitempty"`
	Error string `json:"error,omitempty"`
	Line  int    `json:"line,omitempty"`
}

type libraryReply struct {
	Code  string `json:"code,omitempty"`
	Error string `json:"error,omitempty"`
}

func RunWorkerIfAsked() {
	if os.Getenv(WorkerEnv) == "" {
		return
	}
	if err := serve(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "plantuml worker: %v\n", err)
		os.Exit(1)
	}
	os.Exit(0)
}

func serve(in io.Reader, out io.Writer) error {
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

	requests, readErr := readRequests(in)
	answers := json.NewEncoder(out)
	running := &engineSlot{start: func() (*engine, error) { return startEngine(ctx, runtime, module) }}
	defer running.retire()
	idle := time.NewTimer(idleTimeout)
	defer idle.Stop()
	for {
		select {
		case req, ok := <-requests:
			if !ok {
				if err = <-readErr; errors.Is(err, io.EOF) {
					return nil
				}
				return fmt.Errorf("read a request: %w", err)
			}
			eng, startErr := running.get()
			if startErr != nil {
				return startErr
			}
			res, renderErr := eng.render(req)
			if renderErr != nil {
				return renderErr
			}
			if err = answers.Encode(res); err != nil {
				return fmt.Errorf("write an answer: %w", err)
			}
			if eng.memory() > recycleBytes {
				running.retire()
			}
			idle.Reset(idleTimeout)
		case <-idle.C:
			running.retire()
		}
	}
}

func readRequests(in io.Reader) (<-chan request, <-chan error) {
	requests, failed := make(chan request), make(chan error, 1)
	go func() {
		defer close(requests)
		dec := json.NewDecoder(in)
		for {
			var req request
			if err := dec.Decode(&req); err != nil {
				failed <- err
				return
			}
			requests <- req
		}
	}()
	return requests, failed
}

type engineSlot struct {
	start   func() (*engine, error)
	running *engine
}

func (s *engineSlot) get() (*engine, error) {
	if s.running == nil {
		eng, err := s.start()
		if err != nil {
			return nil, err
		}
		s.running = eng
	}
	return s.running, nil
}

func (s *engineSlot) retire() {
	if s.running == nil {
		return
	}
	s.running.stop()
	s.running = nil
	debug.FreeOSMemory()
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
		enc:      json.NewEncoder(engineIn),
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
	return answer(e.dec, e.enc)
}

func (e *engine) stop() {
	_ = e.in.Close()
	<-e.exited
}

func answer(engine *json.Decoder, toEngine *json.Encoder) (response, error) {
	for {
		var msg engineMessage
		if err := engine.Decode(&msg); err != nil {
			return response{}, fmt.Errorf("read what the engine answered: %w", err)
		}
		if msg.Need == "" {
			return response{SVG: msg.SVG, Error: msg.Error, Line: msg.Line}, nil
		}
		if err := toEngine.Encode(libraryFor(msg.Need)); err != nil {
			return response{}, fmt.Errorf("hand %s to the engine: %w", msg.Need, err)
		}
	}
}

func libraryFor(name string) libraryReply {
	code, err := LibraryFile(name)
	if err != nil {
		return libraryReply{Error: err.Error()}
	}
	return libraryReply{Code: string(code)}
}
