# 2. The bundle's file names carry no hash

Status: accepted. Where it applies:
[frontend](../design/frontend.md#build-and-release).

## Context

The bundle is committed ([ADR 1](0001-committed-frontend-build.md)). With a
hash in every file name, one changed line renamed a dozen files in git, because
a chunk's name is part of each chunk that imports it. A browser still has to
tell one release from the next.

## Decision

The file names carry no hash, so a rebuild changes in git only the files that
changed. The release is told apart by the address: `/static/<digest>/app/`, the
digest of the embedded bundle, taken by the server at startup. The server
answers that digest only and lets a browser keep the files a year.

## Options turned down

- Vite's default hashed names: the renames above.

## Consequences

- A page left open across an upgrade finds its next chunk gone and loads again.
- A chunk's name has to be stable on its own, so a chunk made of a package's
  index is named after the package and not after the file.
