# 1. The built frontend is committed

Status: accepted. Where it applies:
[frontend](../design/frontend.md#build-and-release).

## Context

The frontend is a vite build that needs node and the npm packages. A release of
scrawl is a Go binary, and `go install` and a fresh clone must build it.

## Decision

Vite writes into `server/assets/app/` and `page/assets/`, which are committed
and embedded with `//go:embed`. Nothing is fetched from a CDN at runtime.
`make ui` rebuilds the output, and CI fails when what is committed is stale.

## Options turned down

- Build the frontend during the release or the install. `go install` cannot run
  an npm hook, and a lockfile is not vendoring, so a reproducible release would
  need node and a warm cache.

## Consequences

- Every change in `web/` is followed by `make ui` and a commit of its output.
- The formatter's wasm module is committed for the same reason
  ([ADR 4](0004-prettier-in-wasm.md)).
