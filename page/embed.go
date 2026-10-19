//go:build !gzassets

package page

import "embed"

// assetFiles are built from web/src/page and web/src/site by `make ui`, which
// writes them here.
//
//go:embed assets/page.css assets/page.js assets/math.css assets/math.js assets/diagrams.js
//go:embed assets/site.js assets/site.css assets/boot.js
var assetFiles embed.FS

const assetDir = "assets"
