//go:build tools

// this file only exists so that `go mod tidy` keeps the dependencies the
// project already committed to but no code imports yet. drop an import from
// here as soon as a real package starts using it.
package main

import (
	_ "github.com/alecthomas/chroma/v2"
	_ "github.com/fsnotify/fsnotify"
	_ "github.com/microcosm-cc/bluemonday"
	_ "github.com/yuin/goldmark"
	_ "github.com/yuin/goldmark-highlighting/v2"
	_ "golang.org/x/text/unicode/norm"
	_ "golang.org/x/time/rate"
)
