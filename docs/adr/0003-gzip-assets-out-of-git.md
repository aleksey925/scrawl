# 3. Compressed assets are made at build time and kept out of git

Status: accepted. Where it applies:
[frontend](../design/frontend.md#build-and-release).

## Context

A release embeds the bundle, the pages' assets and the formatter. Stored
gzip-compressed, they go out as stored to a client that accepts gzip, so the
server spends nothing compressing them.

## Decision

Under the `gzassets` build tag a release embeds gzip copies, which
`go run ./gzassets/pack` writes into each package's `gzassets/` before the
build. The copies are not committed. A build without the tag embeds the
committed files as they are, so `go install` and a fresh clone keep building.

## Options turned down

- Commit the `.gz` files. Git keeps no delta between two gzip files, so every
  `make ui` would add the whole bundle to the history.

## Consequences

- `make build`, the image and goreleaser run the pack step first.
- `make test-gzassets` tests the build with the compressed assets.
