# 19. PlantUML's library ships without the AWS, Azure, Elastic and IBM icon sets

Status: accepted. Where it applies: [server](../design/server.md#plantuml),
[site](../design/site.md).

## Context

[ADR 18](0018-plantuml-on-the-server-and-its-library.md) put PlantUML's whole
standard library in the binary, which made it grow from 26MB to 62MB. The cloud
icon sets were 22MB of the 30MB of library, compressed: `ibm` 11.7MB,
`awslib20` 5.1MB, `awslib14` 4.8MB, `awslib10` 0.5MB, `azure` 0.15MB, `elastic`
15KB and `awslib`, a link to `awslib14`. Each icon is drawn twice, as a sprite
and as a PNG, which gzip barely shrinks.

## Decision

- `plantuml/js/library.json` leaves out `awslib`, `awslib10`, `awslib14`,
  `awslib20`, `azure`, `elastic` and `ibm`, so `make plantuml` neither fetches
  nor commits them.
- A diagram that includes one of them fails to draw, with PlantUML's error
  under its code. Another library that includes one, as an example of `gcp`
  does, loads without it.

## Options turned down

- Only the older AWS sets left out: `awslib20` and `ibm` alone are 17MB.
- The library in a separate build, or read from a folder next to the binary:
  two builds to release and test, for sets few notes use.
- zstd or brotli instead of gzip: Go reads neither without another dependency,
  and the gain is a fraction of what dropping the sets gives.

## Consequences

- The library is 7.3MB compressed, and the binary some 40MB.
