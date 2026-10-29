//go:build !gzassets

package page

import "embed"

//go:embed assets/page.css assets/page.js assets/math.css assets/math.js assets/diagrams.js assets/plantuml.js
//go:embed assets/site.js assets/site.css assets/boot.js
var assetFiles embed.FS

const assetDir = "assets"
