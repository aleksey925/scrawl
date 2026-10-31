# 17. PlantUML is drawn in the browser, with Graphviz in wasm

Status: accepted; the standard library and emoji are in
[ADR 18](0018-plantuml-on-the-server-and-its-library.md). Where it applies:
[server](../design/server.md#guards), [site](../design/site.md).

## Context

A note can hold a PlantUML diagram, and scrawl runs no second service. The
official PlantUML build compiled to JavaScript, `@plantuml/core`, draws a
diagram in the browser. Its class, component, state and use case diagrams are
laid out by Graphviz, which it takes as Viz.js, WebAssembly that
`script-src 'self'` refuses to compile.

## Decision

A ` ```plantuml ` or ` ```puml ` fence becomes `<pre class="plantuml">`, and
the reader draws it with `@plantuml/core` the way it draws mermaid. The chunk
carries Viz, and `script-src` is `'self' 'wasm-unsafe-eval'`: it lets a script
of the origin compile WebAssembly, and `eval` and inline scripts stay refused.
Where the wasm is still refused, on a host with a stricter policy or in Safari
before 16, the engine is told there is no Viz and lays out with Smetana,
PlantUML's own port of dot.

## Options turned down

- A PlantUML server or the Java jar: a second service in its own container.
- The engine in Go, through goja or wazero: it measures text with a canvas and
  `getBBox`, and needs a page.
- A PlantUML of our own, or a translation into mermaid: PlantUML is a large
  language, and a subset breaks on real diagrams.
- Smetana alone, which needs no wasm and is 0.6MB smaller gzipped: its layouts
  differ from the ones the same source gets anywhere else.
- A web worker: the engine measures text through `document`, and a page opened
  from disk cannot start a worker from a file.

## Consequences

- A note with a PlantUML block loads a 4.9MB script, 1.7MB gzipped, once.
- The standard library (`!include <C4/...>`) and emoji are not bundled; their
  include shows PlantUML's error.
