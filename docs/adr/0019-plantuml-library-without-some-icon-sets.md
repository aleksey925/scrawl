# 19. PlantUML's library ships without some icon sets

Status: accepted. Where it applies: [server](../design/server.md#plantuml),
[site](../design/site.md).

## Context

[ADR 18](0018-plantuml-on-the-server-and-its-library.md) put PlantUML's whole
standard library in the binary, which made it grow from 26MB to 62MB. Most of
the 30MB of library, compressed, was a few icon sets: `ibm` 11.7MB, `awslib20`
5.1MB, `awslib14` 4.8MB, `tupadr3` 2MB, `logos` 0.7MB, `awslib10` 0.5MB. Each
icon is drawn twice, as a sprite and as a PNG, which gzip barely shrinks.

## Decision

- `plantuml/js/library.json` leaves out these sets, so `make plantuml` neither
  fetches nor commits them: `awslib`, `awslib10`, `awslib14`, `awslib20`,
  `azure`, `cloudinsight`, `cloudogu`, `elastic`, `gcp`, `ibm`, `k8s`,
  `kubernetes`, `logos`, `office`, `osa` and `tupadr3`. `osa2` stays.
- A diagram that includes one of them fails to draw. The browser shows
  PlantUML's picture of the error, the server keeps the code with the error
  under it. Another library that includes one, as the examples of `c4` include
  `office`, loads without it.

## Options turned down

- Only the older AWS sets left out: `awslib20` and `ibm` alone are 17MB.
- The library in a separate build, or read from a folder next to the binary:
  two builds to release and test, for sets few notes use.
- zstd or brotli instead of gzip: Go reads neither without another dependency,
  and the gain is a fraction of what dropping the sets gives.
- The left out sets fetched from GitHub when a diagram needs one: the server
  would need the network, and nothing is fetched at run time.

## Consequences

- The library is 4.1MB compressed, and the binary some 36MB.
