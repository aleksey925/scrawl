//go:build !gzassets

package server

import "embed"

//go:embed assets
var assetFiles embed.FS

const assetDir = "assets"
