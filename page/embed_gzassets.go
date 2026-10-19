//go:build gzassets

package page

import "embed"

//go:embed gzassets/assets
var assetFiles embed.FS

const assetDir = "gzassets/assets"
