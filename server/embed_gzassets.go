//go:build gzassets

package server

import "embed"

//go:embed gzassets/assets
var assetFiles embed.FS

const assetDir = "gzassets/assets"
