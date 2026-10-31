package gzassets

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
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

const Ext = ".gz"

const varyEncoding = "Accept-Encoding"

type Files struct {
	fsys fs.FS
}

func Sub(fsys fs.FS, dir string) Files {
	sub, err := fs.Sub(fsys, dir)
	if err != nil {
		panic(fmt.Sprintf("gzassets: %v", err))
	}
	return Files{fsys: sub}
}

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

func (f Files) Has(name string) bool {
	for _, stored := range []string{name + Ext, name} {
		if info, err := fs.Stat(f.fsys, stored); err == nil && !info.IsDir() {
			return true
		}
	}
	return false
}

func (f Files) Digest(dir string) (string, error) {
	sum := sha256.New()
	err := fs.WalkDir(f.fsys, dir, func(name string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		data, err := fs.ReadFile(f.fsys, name)
		if err != nil {
			return err
		}
		_, _ = fmt.Fprintf(sum, "%s\x00%d\x00", name, len(data))
		_, _ = sum.Write(data)
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("gzassets: %w", err)
	}
	return hex.EncodeToString(sum.Sum(nil)[:6]), nil
}

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
