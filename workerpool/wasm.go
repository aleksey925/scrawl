package workerpool

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/tetratelabs/wazero"
)

var compilationCache wazero.CompilationCache

func UseCompilationCache() error {
	cache, err := wazero.NewCompilationCacheWithDir(filepath.Join(os.TempDir(), "scrawl-wasm-cache"))
	if err != nil {
		return fmt.Errorf("open the compilation cache: %w", err)
	}
	compilationCache = cache
	return nil
}

func RuntimeConfig() wazero.RuntimeConfig {
	cfg := wazero.NewRuntimeConfig()
	if compilationCache != nil {
		cfg = cfg.WithCompilationCache(compilationCache)
	}
	return cfg
}
