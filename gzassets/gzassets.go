// Package gzassets reads the files a package embeds, which a build with the
// gzassets tag stores gzip-compressed. A file stored as name.gz is read as
// name, so the code that reads a file does not know which build it is in.
package gzassets

import (
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"path"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Ext is what a compressed file adds to the name of the file it holds.
const Ext = ".gz"

const varyEncoding = "Accept-Encoding"

// Files is a tree of embedded files, each stored either as it is or
// compressed under its name with Ext added.
type Files struct {
	fsys fs.FS
}

// Sub returns the files under dir of fsys. It panics when dir is not a valid
// path, because dir is a constant naming where a package embeds its files.
func Sub(fsys fs.FS, dir string) Files {
	sub, err := fs.Sub(fsys, dir)
	if err != nil {
		panic(fmt.Sprintf("gzassets: %v", err))
	}
	return Files{fsys: sub}
}

// ReadFile returns the content of name, decompressed when it is stored
// compressed.
func (f Files) ReadFile(name string) ([]byte, error) {
	packed, err := fs.ReadFile(f.fsys, name+Ext)
	if errors.Is(err, fs.ErrNotExist) {
		return fs.ReadFile(f.fsys, name)
	}
	if err != nil {
		return nil, err
	}
	return decompress(packed)
}

// ServeFile answers with name. A file stored compressed goes out as it is
// stored to a client that accepts gzip and decompressed to any other.
func (f Files) ServeFile(w http.ResponseWriter, r *http.Request, name string) {
	packed, err := fs.ReadFile(f.fsys, name+Ext)
	if err != nil {
		http.ServeFileFS(w, r, f.fsys, name)
		return
	}
	if !slices.Contains(w.Header().Values("Vary"), varyEncoding) {
		w.Header().Add("Vary", varyEncoding)
	}
	body := packed
	if acceptsGzip(r.Header.Get("Accept-Encoding")) {
		w.Header().Set("Content-Encoding", "gzip")
	} else if body, err = decompress(packed); err != nil {
		http.Error(w, "broken embedded file", http.StatusInternalServerError)
		return
	}
	http.ServeContent(w, r, path.Base(name), time.Time{}, bytes.NewReader(body))
}

// Compress returns data compressed at the best level. The header holds no
// name and no time, so the same data always gives the same bytes.
func Compress(data []byte) ([]byte, error) {
	var buf bytes.Buffer
	zw, err := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	if err != nil {
		return nil, fmt.Errorf("gzassets: %w", err)
	}
	if _, err = zw.Write(data); err != nil {
		return nil, fmt.Errorf("gzassets: %w", err)
	}
	if err = zw.Close(); err != nil {
		return nil, fmt.Errorf("gzassets: %w", err)
	}
	return buf.Bytes(), nil
}

// decompress returns the data Compress was given.
func decompress(packed []byte) ([]byte, error) {
	zr, err := gzip.NewReader(bytes.NewReader(packed))
	if err != nil {
		return nil, fmt.Errorf("gzassets: %w", err)
	}
	data, err := io.ReadAll(zr)
	if err != nil {
		return nil, fmt.Errorf("gzassets: %w", err)
	}
	return data, nil
}

// acceptsGzip reads an Accept-Encoding header, where "gzip;q=0" is a refusal.
func acceptsGzip(header string) bool {
	for field := range strings.SplitSeq(header, ",") {
		coding, params, _ := strings.Cut(field, ";")
		if !strings.EqualFold(strings.TrimSpace(coding), "gzip") {
			continue
		}
		weight, found := strings.CutPrefix(strings.TrimSpace(params), "q=")
		if !found {
			return true
		}
		q, err := strconv.ParseFloat(weight, 64)
		return err == nil && q > 0
	}
	return false
}
