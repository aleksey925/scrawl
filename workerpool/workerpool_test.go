package workerpool

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testEnv = "SCRAWL_WORKERPOOL_TEST_WORKER"

type echoRequest struct {
	Text  string        `json:"text"`
	Sleep time.Duration `json:"sleep"`
}

type echoResponse struct {
	Text string `json:"text"`
	PID  int    `json:"pid"`
}

func TestMain(m *testing.M) {
	if os.Getenv(testEnv) != "" {
		dec, enc := json.NewDecoder(os.Stdin), json.NewEncoder(os.Stdout)
		for {
			var req echoRequest
			if err := dec.Decode(&req); err != nil {
				os.Exit(0)
			}
			time.Sleep(req.Sleep)
			_ = enc.Encode(echoResponse{Text: strings.ToUpper(req.Text), PID: os.Getpid()})
		}
	}
	os.Exit(m.Run())
}

func TestAsk(t *testing.T) {
	// arrange
	pool := New[echoRequest, echoResponse]("echo", testEnv, 1)
	t.Cleanup(pool.Close)

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
	pool := New[echoRequest, echoResponse]("echo", testEnv, 1)
	t.Cleanup(pool.Close)
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

func TestAskAfterClose(t *testing.T) {
	// arrange
	pool := New[echoRequest, echoResponse]("echo", testEnv, 1)
	pool.Close()

	// act
	_, err := pool.Ask(context.Background(), echoRequest{Text: "x"})

	// assert
	require.ErrorContains(t, err, "the echo is closed")
}
