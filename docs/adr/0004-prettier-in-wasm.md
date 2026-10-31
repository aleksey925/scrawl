# 4. Prettier runs inside the binary as a wasm module

Status: accepted. Where it applies: [formatter](../design/formatter.md).

## Context

A note saved in scrawl must come back unchanged from `prettier --write`, so the
formatter has to be prettier itself. The binary has no node and no cgo.

## Decision

`format` embeds one wasm module holding prettier and QuickJS, built by javy,
and wazero executes it with no cgo. The prettier version is the one `mise.toml`
pins, and the plugins are the ones the command line loads.

## Options turned down

- A port of prettier to Go: none exists.
- goja: it ran prettier five times slower and could not load every plugin.

## Consequences

- The module is committed for the reason the bundle is
  ([ADR 1](0001-committed-frontend-build.md)), and `make formatter` rebuilds
  it.
- Javy's output is not byte-reproducible, so the guard is a test on what it
  formats and not a diff in CI.
- The run cannot be stopped from inside, which led to
  [ADR 6](0006-prettier-in-worker-processes.md).
