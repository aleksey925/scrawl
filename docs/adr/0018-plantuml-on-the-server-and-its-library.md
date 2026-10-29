# 18. PlantUML on the server runs in QuickJS, and its library ships in the binary

Status: accepted. Where it applies: [server](../design/server.md#plantuml),
[command line](../design/cli.md), [site](../design/site.md).

## Context

An exported note and a page of `scrawl render` have no browser to draw a
diagram, and a diagram that stays code is of little use there. PlantUML's
standard library, `!include <C4/...>`, `<awslib/...>` and the rest, is not in
the npm package, and nothing may be fetched from a CDN.

## Decision

- The server draws with PlantUML's headless build, the one its MCP server runs
  in node, put into QuickJS by javy and run by wazero, in worker processes as
  prettier is ([ADR 4](0004-prettier-in-wasm.md),
  [ADR 6](0006-prettier-in-worker-processes.md)). The pool of workers is one
  package, `workerpool`, for both. The layout is Smetana, as QuickJS has no
  WebAssembly for Graphviz.
- The headless build draws no raster image into an SVG, and every sprite is
  one. `make plantuml` registers a driver for it that writes a PNG, the way the
  JVM's SVG does.
- The whole standard library, with themes, OpenIconic and emoji, is taken from
  the PlantUML commit both engines were built from, checked by sha256, and
  committed compressed. A file is loaded when a diagram includes it: by the
  browser from `/static/<version>/plantuml/`, by a worker from the binary, and
  a site gets the files its notes include.

## Options turned down

- The C build of PlantUML: it draws mind maps only.
- The WebAssembly build: it needs WebAssembly GC, which wazero has not.
- The browser build on the server: it builds the SVG through the DOM and
  measures text with a canvas.
- goja: slower than QuickJS for prettier already.
- A library file by file instead of library by library: a library includes its
  own files by names it computes, `!include <awslib/$item/all.puml>`.
- The library left out or fetched from GitHub at run time: an include would
  fail, and nothing is fetched from a CDN.

## Consequences

- The binary grows by some 33MB: 29MB of library and 4MB of engine, both
  compressed.
- On the server a diagram takes 0.1 to 0.3s, C4 5 to 10s: its preprocessing is
  heavy for an interpreter. A drawn diagram is kept in a cache by its source.
- A large library takes hundreds of megabytes while it loads. A worker lets its
  engine go once the engine's memory passes 256MB, and after two idle minutes.
