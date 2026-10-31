package plantuml

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"runtime/debug"
	"strings"
	"sync/atomic"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
	"github.com/tetratelabs/wazero/sys"

	"github.com/aleksey925/scrawl/gzassets"
	"github.com/aleksey925/scrawl/workerpool"
)

const engineFile = "engine.wasm"

const engineFailed = "the server's PlantUML engine failed on this diagram"

const (
	maxSVG      = 8 << 20
	svgTooLarge = "the drawn diagram is too large to keep"
)

const (
	maxErrorText = 1 << 10
	cutMark      = "..."
)

type caps struct {
	svg       int
	errorText int
}

var workerCaps = caps{svg: maxSVG, errorText: maxErrorText}

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
	runWorkerIfAsked(retireBytes)
}

func runWorkerIfAsked(retireAt uint32) {
	workerpool.RunIfAsked(workerEnv, workerName, func(in io.Reader, out io.Writer) error {
		return serve(in, out, retireAt, workerCaps)
	})
}

func serve(in io.Reader, out io.Writer, retireAt uint32, limits caps) error {
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
			cause, _, _ := strings.Cut(renderErr.Error(), "\n")
			fmt.Fprintf(os.Stderr, "%s: %s\n", workerName, cause)
			res = response{Error: engineFailed, Retire: true}
		} else {
			if len(res.SVG) > limits.svg {
				res = response{Error: svgTooLarge}
			}
			res.Error = cut(res.Error, limits.errorText)
			res.Retire = eng.memory() > retireAt
		}
		if err = answers.Encode(res); err != nil {
			return fmt.Errorf("write an answer: %w", err)
		}
		if res.Retire {
			return nil
		}
		debug.FreeOSMemory()
	}
}

func cut(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	return strings.ToValidUTF8(text[:limit], "") + cutMark
}

func newEncoder(w io.Writer) *json.Encoder {
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	return enc
}

type engine struct {
	out    *engineOutput
	in     *io.PipeWriter
	enc    *json.Encoder
	dec    *json.Decoder
	exited chan struct{}
}

type engineOutput struct {
	w        io.Writer
	instance api.Module
	size     atomic.Uint32
}

func (o *engineOutput) Write(p []byte) (int, error) {
	o.size.Store(o.instance.Memory().Size())
	return o.w.Write(p)
}

func startEngine(ctx context.Context, runtime wazero.Runtime, module wazero.CompiledModule) (*engine, error) {
	toEngine, engineIn := io.Pipe()
	engineOut, fromEngine := io.Pipe()
	out := &engineOutput{w: fromEngine}
	cfg := wazero.NewModuleConfig().WithName("").WithStartFunctions().
		WithStdin(toEngine).WithStdout(out).WithStderr(os.Stderr)
	instance, err := runtime.InstantiateModule(ctx, module, cfg)
	if err != nil {
		return nil, fmt.Errorf("start the engine: %w", err)
	}
	out.instance = instance
	e := &engine{
		out:    out,
		in:     engineIn,
		enc:    newEncoder(engineIn),
		dec:    json.NewDecoder(engineOut),
		exited: make(chan struct{}),
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
	return e.out.size.Load()
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
	code, err := libraryFile(name)
	if err != nil {
		return libraryReply{Error: err.Error()}
	}
	return libraryReply{Code: string(code)}
}
