//go:build gzassets

package plantuml

import "embed"

//go:embed gzassets/engine.wasm.gz
var engineFiles embed.FS

const engineDir = "gzassets"
