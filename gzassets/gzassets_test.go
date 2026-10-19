package gzassets

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const script = "console.log('a script long enough to be worth compressing, again and again and again');"

func newFiles(t *testing.T) Files {
	t.Helper()
	packed, err := Compress([]byte(script))
	require.NoError(t, err)
	return Sub(fstest.MapFS{
		"assets/app.js" + Ext: {Data: packed},
		"assets/icon.png":     {Data: []byte("not compressed")},
	}, "assets")
}

func TestSub(t *testing.T) {
	// act & assert
	assert.Panics(t, func() { Sub(fstest.MapFS{}, "../assets") })
}

func TestCompress(t *testing.T) {
	// arrange
	data := []byte(script)

	// act
	first, err := Compress(data)
	require.NoError(t, err)
	second, err := Compress(data)
	require.NoError(t, err)

	// assert
	assert.Equal(t, first, second)
	got, err := decompress(first)
	require.NoError(t, err)
	assert.Equal(t, data, got)
}

func TestFiles_ReadFile(t *testing.T) {
	tests := []struct {
		name    string
		file    string
		want    string
		wantErr bool
	}{
		{name: "decompresses a compressed file", file: "app.js", want: script},
		{name: "reads a file stored as it is", file: "icon.png", want: "not compressed"},
		{name: "fails on a missing file", file: "missing.js", wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			files := newFiles(t)

			// act
			got, err := files.ReadFile(tc.file)

			// assert
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, string(got))
		})
	}
}

func TestFiles_ServeFile(t *testing.T) {
	packed, err := Compress([]byte(script))
	require.NoError(t, err)
	tests := []struct {
		name         string
		file         string
		accept       string
		vary         string
		wantStatus   int
		wantBody     string
		wantEncoding string
		wantVary     []string
		wantType     string
	}{
		{
			name: "sends a compressed file as it is stored", file: "app.js", accept: "br, gzip",
			wantStatus: http.StatusOK, wantBody: string(packed), wantEncoding: "gzip",
			wantVary: []string{"Accept-Encoding"}, wantType: "text/javascript; charset=utf-8",
		},
		{
			name: "decompresses for a client without gzip", file: "app.js", accept: "br",
			wantStatus: http.StatusOK, wantBody: script,
			wantVary: []string{"Accept-Encoding"}, wantType: "text/javascript; charset=utf-8",
		},
		{
			name: "decompresses for a client that refuses gzip", file: "app.js", accept: "gzip;q=0",
			wantStatus: http.StatusOK, wantBody: script,
			wantVary: []string{"Accept-Encoding"}, wantType: "text/javascript; charset=utf-8",
		},
		{
			name: "adds no second Vary to one already set", file: "app.js", accept: "gzip", vary: "Accept-Encoding",
			wantStatus: http.StatusOK, wantBody: string(packed), wantEncoding: "gzip",
			wantVary: []string{"Accept-Encoding"}, wantType: "text/javascript; charset=utf-8",
		},
		{
			name: "sends a file stored as it is", file: "icon.png", accept: "gzip",
			wantStatus: http.StatusOK, wantBody: "not compressed", wantType: "image/png",
		},
		{
			name: "answers 404 for a missing file", file: "missing.js", accept: "gzip",
			wantStatus: http.StatusNotFound, wantBody: "404 page not found\n", wantType: "text/plain; charset=utf-8",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// arrange
			files := newFiles(t)
			req := httptest.NewRequest(http.MethodGet, "/"+tc.file, http.NoBody)
			req.Header.Set("Accept-Encoding", tc.accept)
			rec := httptest.NewRecorder()
			if tc.vary != "" {
				rec.Header().Set("Vary", tc.vary)
			}

			// act
			files.ServeFile(rec, req, tc.file)

			// assert
			res := rec.Result()
			body, readErr := io.ReadAll(res.Body)
			require.NoError(t, readErr)
			assert.Equal(t, tc.wantStatus, res.StatusCode)
			assert.Equal(t, tc.wantBody, string(body))
			assert.Equal(t, tc.wantEncoding, res.Header.Get("Content-Encoding"))
			assert.Equal(t, tc.wantVary, res.Header.Values("Vary"))
			assert.Equal(t, tc.wantType, res.Header.Get("Content-Type"))
		})
	}
}

func TestAcceptsGzip(t *testing.T) {
	tests := []struct {
		header string
		want   bool
	}{
		{header: "", want: false},
		{header: "gzip", want: true},
		{header: "deflate, GZIP", want: true},
		{header: "gzip;q=0.5", want: true},
		{header: "gzip; q=0", want: false},
		{header: "gzip;q=0.000", want: false},
		{header: "br, deflate", want: false},
		{header: "x-gzip", want: false},
	}
	for _, tc := range tests {
		t.Run(tc.header, func(t *testing.T) {
			// act
			got := acceptsGzip(tc.header)

			// assert
			assert.Equal(t, tc.want, got)
		})
	}
}
