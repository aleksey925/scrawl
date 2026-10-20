package main

import (
	"crypto/rand"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/aleksey925/scrawl/gzassets"
)

func writeTree(t *testing.T, dir string, files map[string][]byte) {
	t.Helper()
	for name, data := range files {
		full := filepath.Join(dir, filepath.FromSlash(name))
		require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o755))
		require.NoError(t, os.WriteFile(full, data, 0o644))
	}
}

func readTree(t *testing.T, dir string) map[string][]byte {
	t.Helper()
	res := map[string][]byte{}
	require.NoError(t, fs.WalkDir(os.DirFS(dir), ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		data, readErr := os.ReadFile(filepath.Join(dir, filepath.FromSlash(name)))
		res[name] = data
		return readErr
	}))
	return res
}

func compressed(t *testing.T, data []byte) []byte {
	t.Helper()
	res, err := gzassets.Compress(data)
	require.NoError(t, err)
	return res
}

func TestPack(t *testing.T) {
	// arrange
	dir := t.TempDir()
	script := []byte(strings.Repeat("console.log('compressible');\n", 100))
	style := []byte(strings.Repeat("body { color: red; }\n", 100))
	wasm := []byte(strings.Repeat("\x00asm", 1000))
	picture := make([]byte, 1024)
	_, err := rand.Read(picture)
	require.NoError(t, err)
	writeTree(t, dir, map[string][]byte{
		"server/assets/app.js":         script,
		"server/assets/css/app.css":    style,
		"server/assets/icon.png":       picture,
		"server/assets/.DS_Store":      script,
		"server/assets/_chunks/x.js":   script,
		"server/gzassets/stale.js.gz":  script,
		"format/prettier.wasm":         wasm,
		"format/prettier_unrelated.go": script,
	})

	// act
	err = pack(dir, []string{"server/assets", "format/prettier.wasm"})

	// assert
	require.NoError(t, err)
	assert.Equal(t, map[string][]byte{
		"assets/app.js.gz":      compressed(t, script),
		"assets/css/app.css.gz": compressed(t, style),
		"assets/icon.png":       picture,
	}, readTree(t, filepath.Join(dir, "server", "gzassets")))
	assert.Equal(t, map[string][]byte{
		"prettier.wasm.gz": compressed(t, wasm),
	}, readTree(t, filepath.Join(dir, "format", "gzassets")))
}

func TestPack_refusesASourceOutsideAPackage(t *testing.T) {
	// arrange
	dir := t.TempDir()
	writeTree(t, dir, map[string][]byte{"assets.js": []byte("x")})

	// act
	err := pack(dir, []string{"assets.js"})

	// assert
	require.EqualError(t, err, "assets.js is not inside a package")
}
