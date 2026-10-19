//go:build !gzassets

package format

import "embed"

//go:embed prettier.wasm
var wasmFiles embed.FS

const wasmDir = "."
