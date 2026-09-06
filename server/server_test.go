package server

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWebRouter(t *testing.T) {
	// arrange
	wb := &Web{Config: Config{ListenAddr: "127.0.0.1:0", Title: "Test KB", Version: "v1.2.3"}}
	router, err := wb.router()
	require.NoError(t, err)

	ts := httptest.NewServer(router)
	defer ts.Close()

	tests := []struct {
		name        string
		path        string
		status      int
		body        string
		contentType string
	}{
		{name: "ping", path: "/ping", status: http.StatusOK, body: "pong", contentType: "text/plain"},
		{name: "asset css", path: "/static/v1.2.3/css/style.css", status: http.StatusOK, contentType: "text/css"},
		{name: "asset js", path: "/static/v1.2.3/js/app.js", status: http.StatusOK},
		{name: "asset missing", path: "/static/v1.2.3/css/nope.css", status: http.StatusNotFound},
		{name: "asset empty path", path: "/static/v1.2.3/", status: http.StatusNotFound},
		{name: "templates not served as assets", path: "/static/v1.2.3/../templates/base.html", status: http.StatusMovedPermanently},
		{name: "unknown route", path: "/nothing", status: http.StatusNotFound},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// act
			req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, ts.URL+tc.path, http.NoBody)
			require.NoError(t, err)
			client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
			resp, err := client.Do(req)
			require.NoError(t, err)
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)

			// assert
			assert.Equal(t, tc.status, resp.StatusCode)
			if tc.body != "" {
				assert.Equal(t, tc.body, string(body))
			}
			if tc.contentType != "" {
				assert.Contains(t, resp.Header.Get("Content-Type"), tc.contentType)
			}
		})
	}
}

func TestWebRouterAppInfoHeaders(t *testing.T) {
	// arrange
	wb := &Web{Config: Config{Version: "v9.9.9"}}
	router, err := wb.router()
	require.NoError(t, err)

	// act
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/ping", http.NoBody))

	// assert
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "mdserver", rec.Header().Get("App-Name"))
	assert.Equal(t, "v9.9.9", rec.Header().Get("App-Version"))
}

func TestWebRunEmptyListenAddr(t *testing.T) {
	// arrange
	wb := &Web{}

	// act
	err := wb.Run(t.Context())

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "listen address")
}

func TestWebRunGracefulShutdown(t *testing.T) {
	// arrange
	addr := fmt.Sprintf("127.0.0.1:%d", freePort(t))
	wb := &Web{Config: Config{
		ListenAddr:        addr,
		Version:           "test",
		ReadHeaderTimeout: time.Second,
		ReadTimeout:       5 * time.Second,
		WriteTimeout:      5 * time.Second,
		IdleTimeout:       5 * time.Second,
		ShutdownTimeout:   2 * time.Second,
	}}

	ctx, cancel := context.WithCancel(t.Context())
	errCh := make(chan error, 1)
	go func() { errCh <- wb.Run(ctx) }()

	// act
	resp := waitForPing(t, "http://"+addr+"/ping")
	defer resp.Body.Close()
	cancel()

	// assert
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	select {
	case err := <-errCh:
		assert.NoError(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("server did not stop in time")
	}
}

func TestWebRunBusyPort(t *testing.T) {
	// arrange
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()

	wb := &Web{Config: Config{ListenAddr: ln.Addr().String()}}

	// act
	err = wb.Run(t.Context())

	// assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "server failed")
}

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	port := ln.Addr().(*net.TCPAddr).Port
	require.NoError(t, ln.Close())
	return port
}

func waitForPing(t *testing.T, url string) *http.Response {
	t.Helper()
	var lastErr error
	for range 100 {
		req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, url, http.NoBody)
		require.NoError(t, err)
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			return resp
		}
		lastErr = err
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("server never answered on %s: %v", url, lastErr)
	return nil
}
