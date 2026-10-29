package workerpool

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testEnv = "SCRAWL_WORKERPOOL_TEST_WORKER"

type echoRequest struct {
	Text    string        `json:"text"`
	Sleep   time.Duration `json:"sleep"`
	Crash   bool          `json:"crash"`
	Garbage bool          `json:"garbage"`
	Last    bool          `json:"last"`
}

type echoResponse struct {
	Text string `json:"text"`
	PID  int    `json:"pid"`
	Last bool   `json:"last"`
}

func (r echoResponse) Retiring() bool {
	return r.Last
}

func TestMain(m *testing.M) {
	RunIfAsked(testEnv, "echo worker", func(in io.Reader, out io.Writer) error {
		dec, enc := json.NewDecoder(in), json.NewEncoder(out)
		for {
			var req echoRequest
			if err := dec.Decode(&req); err != nil {
				if errors.Is(err, io.EOF) {
					return nil
				}
				return err
			}
			time.Sleep(req.Sleep)
			switch {
			case req.Crash:
				return errors.New("asked to crash")
			case req.Garbage:
				_, _ = out.Write([]byte("not json\n"))
			default:
				_ = enc.Encode(echoResponse{Text: strings.ToUpper(req.Text), PID: os.Getpid(), Last: req.Last})
			}
		}
	})
	os.Exit(m.Run())
}

func newEchoPool(t *testing.T, opts Options) *Pool[echoRequest, echoResponse] {
	t.Helper()
	opts.Name, opts.Env = "echo", testEnv
	opts.Workers = max(opts.Workers, 1)
	pool := New[echoRequest, echoResponse](opts)
	t.Cleanup(pool.Close)
	return pool
}

func gone(pid int) func() bool {
	return func() bool { return syscall.Kill(pid, 0) != nil }
}

func TestAsk(t *testing.T) {
	// arrange
	pool := newEchoPool(t, Options{})

	// act
	first, err := pool.Ask(context.Background(), echoRequest{Text: "one"})
	require.NoError(t, err)
	second, err := pool.Ask(context.Background(), echoRequest{Text: "two"})
	require.NoError(t, err)

	// assert
	assert.Equal(t, "ONE", first.Text)
	assert.Equal(t, "TWO", second.Text)
	assert.Equal(t, first.PID, second.PID, "a worker serves call after call")
}

func TestAskKillsAWorkerThatOutlivesTheDeadline(t *testing.T) {
	// arrange
	pool := newEchoPool(t, Options{})
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	before, err := pool.Ask(context.Background(), echoRequest{Text: "warm"})
	require.NoError(t, err)

	// act
	_, lateErr := pool.Ask(ctx, echoRequest{Text: "late", Sleep: time.Minute})
	next, err := pool.Ask(context.Background(), echoRequest{Text: "next"})

	// assert
	require.ErrorIs(t, lateErr, context.DeadlineExceeded)
	require.NoError(t, err)
	assert.Equal(t, "NEXT", next.Text)
	assert.NotEqual(t, before.PID, next.PID, "the worker that missed the deadline is replaced")
}

func TestAskKillsAWorkerThatOutlivesTheLimit(t *testing.T) {
	// arrange
	pool := newEchoPool(t, Options{Limit: 50 * time.Millisecond})

	// act
	_, err := pool.Ask(context.Background(), echoRequest{Text: "late", Sleep: time.Minute})

	// assert
	require.ErrorIs(t, err, context.DeadlineExceeded)
}

func TestAskCountsTheLimitFromTheMomentAWorkerIsFree(t *testing.T) {
	// arrange
	pool := newEchoPool(t, Options{Limit: time.Second})
	busy := make(chan error, 1)
	go func() {
		_, err := pool.Ask(context.Background(), echoRequest{Text: "busy", Sleep: 700 * time.Millisecond})
		busy <- err
	}()
	time.Sleep(100 * time.Millisecond)

	// act
	res, err := pool.Ask(context.Background(), echoRequest{Text: "waited", Sleep: 500 * time.Millisecond})

	// assert
	require.NoError(t, <-busy)
	require.NoError(t, err)
	assert.Equal(t, "WAITED", res.Text)
}

func TestAskGivesUpWaitingForABusyWorker(t *testing.T) {
	// arrange
	pool := newEchoPool(t, Options{})
	busy := make(chan echoResponse, 1)
	go func() {
		res, _ := pool.Ask(context.Background(), echoRequest{Text: "busy", Sleep: 500 * time.Millisecond})
		busy <- res
	}()
	time.Sleep(100 * time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	// act
	_, err := pool.Ask(ctx, echoRequest{Text: "impatient"})

	// assert
	require.ErrorIs(t, err, context.DeadlineExceeded)
	assert.ErrorContains(t, err, "wait for a echo")
	assert.Equal(t, "BUSY", (<-busy).Text, "the waiting call does not disturb the running one")
}

func TestAskDoesNotTakeAWorkerForADoneContext(t *testing.T) {
	// arrange
	pool := newEchoPool(t, Options{})
	before, err := pool.Ask(context.Background(), echoRequest{Text: "warm"})
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	// act
	_, doneErr := pool.Ask(ctx, echoRequest{Text: "x"})
	after, err := pool.Ask(context.Background(), echoRequest{Text: "y"})

	// assert
	require.ErrorIs(t, doneErr, context.Canceled)
	require.NoError(t, err)
	assert.Equal(t, before.PID, after.PID)
}

func TestAskReplacesAWorkerThatFailed(t *testing.T) {
	tests := []struct {
		name string
		req  echoRequest
		want string
	}{
		{name: "a worker that crashes", req: echoRequest{Crash: true}, want: "read what the echo answered"},
		{name: "a worker that answers garbage", req: echoRequest{Garbage: true}, want: "read what the echo answered"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			pool := newEchoPool(t, Options{})
			before, err := pool.Ask(context.Background(), echoRequest{Text: "warm"})
			require.NoError(t, err)

			// act
			_, failed := pool.Ask(context.Background(), tc.req)
			next, err := pool.Ask(context.Background(), echoRequest{Text: "next"})

			// assert
			require.ErrorContains(t, failed, tc.want)
			require.NoError(t, err)
			assert.Equal(t, "NEXT", next.Text)
			assert.NotEqual(t, before.PID, next.PID)
			assert.Eventually(t, gone(before.PID), time.Second, 10*time.Millisecond)
		})
	}
}

func TestAskStopsAWorkerAfterItsLastAnswer(t *testing.T) {
	// arrange
	pool := newEchoPool(t, Options{})

	// act
	last, err := pool.Ask(context.Background(), echoRequest{Text: "last", Last: true})
	require.NoError(t, err)
	next, err := pool.Ask(context.Background(), echoRequest{Text: "next"})

	// assert
	require.NoError(t, err)
	assert.Equal(t, "LAST", last.Text)
	assert.NotEqual(t, last.PID, next.PID)
	assert.Eventually(t, gone(last.PID), time.Second, 10*time.Millisecond)
}

func TestAnIdleWorkerIsStopped(t *testing.T) {
	// arrange
	pool := newEchoPool(t, Options{Idle: 50 * time.Millisecond})
	first, err := pool.Ask(context.Background(), echoRequest{Text: "one"})
	require.NoError(t, err)

	// act
	require.Eventually(t, gone(first.PID), 2*time.Second, 10*time.Millisecond)
	next, err := pool.Ask(context.Background(), echoRequest{Text: "two"})

	// assert
	require.NoError(t, err)
	assert.Equal(t, "TWO", next.Text)
	assert.NotEqual(t, first.PID, next.PID)
}

func TestAWorkerInUseIsNotStoppedAsIdle(t *testing.T) {
	// arrange
	pool := newEchoPool(t, Options{Idle: 50 * time.Millisecond})
	first, err := pool.Ask(context.Background(), echoRequest{Text: "one"})
	require.NoError(t, err)

	// act
	second, err := pool.Ask(context.Background(), echoRequest{Text: "two", Sleep: 200 * time.Millisecond})

	// assert
	require.NoError(t, err)
	assert.Equal(t, first.PID, second.PID)
}

func TestCloseDuringACall(t *testing.T) {
	// arrange
	pool := newEchoPool(t, Options{})
	type outcome struct {
		res echoResponse
		err error
	}
	running := make(chan outcome, 1)
	go func() {
		res, err := pool.Ask(context.Background(), echoRequest{Text: "running", Sleep: 300 * time.Millisecond})
		running <- outcome{res: res, err: err}
	}()
	time.Sleep(100 * time.Millisecond)

	// act
	pool.Close()
	out := <-running
	_, after := pool.Ask(context.Background(), echoRequest{Text: "after"})

	// assert
	require.NoError(t, out.err, "a call already running gets its answer")
	assert.Equal(t, "RUNNING", out.res.Text)
	assert.Eventually(t, gone(out.res.PID), time.Second, 10*time.Millisecond, "its worker is stopped once it is back")
	require.ErrorContains(t, after, "the echo is closed")
}

func TestAskAfterClose(t *testing.T) {
	// arrange
	pool := newEchoPool(t, Options{})
	pool.Close()

	// act
	_, err := pool.Ask(context.Background(), echoRequest{Text: "x"})

	// assert
	require.ErrorContains(t, err, "the echo is closed")
}
