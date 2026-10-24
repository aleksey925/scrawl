# 5. The editor formats in the browser, the server formats the rest

Status: accepted. Where it applies: [formatter](../design/formatter.md).

## Context

The server's prettier is interpreted ([ADR 4](0004-prettier-in-wasm.md)): about
30ms a kilobyte, against almost nothing in a browser. A save of the longest
note here took eight seconds.

## Decision

There are two copies of prettier, and each write goes through exactly one. The
editor formats in the browser, on the button and before a save, and says so
with `formatted` in the request. Every other writer - an API client, a restore,
an editor whose prettier would not load - leaves that out, and the server
formats in `formatOnSave`.

## Options turned down

- The server alone: one copy and one answer, but seconds on every save of a
  long note.

## Consequences

- The two copies must be the same version, and a test holds them together.
