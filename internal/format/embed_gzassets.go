//go:build gzassets

package format

import "embed"

//go:embed gzassets/prettier.wasm.gz
var wasmFiles embed.FS

const wasmDir = "gzassets"
