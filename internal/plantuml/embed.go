//go:build !gzassets

package plantuml

import "embed"

//go:embed engine.wasm
var engineFiles embed.FS

const engineDir = "."
