// Command pack writes the files a build with the gzassets tag embeds. Each
// source, a path inside one package, is copied into that package's gzassets/
// directory, compressed where that makes it smaller. It runs from the root of
// the repository.
package main

import (
	"fmt"
	"io/fs"
	"os"
	"path"
	"strings"

	"github.com/aleksey925/scrawl/gzassets"
)

// sources are what the packages embed and the gzassets build compresses.
var sources = []string{"server/assets", "page/assets", "format/prettier.wasm"}

// outDir is where in its package the gzassets build embeds a source from.
const outDir = "gzassets"

// minSaving is the share a compressed copy must save to be kept. A picture
// or a font is compressed already, and is stored as it is.
const minSaving = 0.1

func main() {
	if err := pack(".", sources); err != nil {
		fmt.Fprintf(os.Stderr, "pack: %v\n", err)
		os.Exit(1)
	}
}

// pack writes every source below dir into its package's outDir, removing
// whatever an earlier run left there.
func pack(dir string, srcs []string) error {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return fmt.Errorf("open %s: %w", dir, err)
	}
	defer root.Close()

	cleared := map[string]bool{}
	for _, src := range srcs {
		pkg, _, found := strings.Cut(src, "/")
		if !found {
			return fmt.Errorf("%s is not inside a package", src)
		}
		if !cleared[pkg] {
			if err = root.RemoveAll(path.Join(pkg, outDir)); err != nil {
				return fmt.Errorf("clear %s: %w", path.Join(pkg, outDir), err)
			}
			cleared[pkg] = true
		}
		if err = fs.WalkDir(root.FS(), src, func(name string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			return packEntry(root, pkg, name, entry)
		}); err != nil {
			return fmt.Errorf("pack %s: %w", src, err)
		}
	}
	return nil
}

// packEntry copies one file of the walk. What go:embed of a directory skips,
// a name starting with a dot or an underscore, is skipped here too.
func packEntry(root *os.Root, pkg, name string, entry fs.DirEntry) error {
	if strings.HasPrefix(entry.Name(), ".") || strings.HasPrefix(entry.Name(), "_") {
		if entry.IsDir() {
			return fs.SkipDir
		}
		return nil
	}
	if entry.IsDir() {
		return nil
	}
	data, err := root.ReadFile(name)
	if err != nil {
		return fmt.Errorf("read %s: %w", name, err)
	}
	packed, err := gzassets.Compress(data)
	if err != nil {
		return fmt.Errorf("compress %s: %w", name, err)
	}
	out := path.Join(pkg, outDir, strings.TrimPrefix(name, pkg+"/"))
	if float64(len(packed)) <= float64(len(data))*(1-minSaving) {
		out, data = out+gzassets.Ext, packed
	}
	if err = root.MkdirAll(path.Dir(out), 0o755); err != nil {
		return fmt.Errorf("create %s: %w", path.Dir(out), err)
	}
	if err = root.WriteFile(out, data, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", out, err)
	}
	return nil
}
