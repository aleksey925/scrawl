# 6. Prettier runs in worker processes

Status: accepted. Where it applies: [formatter](../design/formatter.md).

## Context

Prettier is quadratic on some text: 8KB of `[` runs for half a minute, 256KB
for hours. Nothing can stop a run from inside: wazero only watches a context
when every branch of the compiled code checks it, and that made a run five
times slower.

## Decision

Prettier runs in worker processes, copies of this binary started with
`SCRAWL_FORMAT_WORKER` set, and never inside the server. A process can be
killed, so the deadline of a call is a real one, and the next call gets a fresh
worker.

## Options turned down

- Run inside the server with a context checked by wazero: five times slower.

## Consequences

- `main` asks `format.RunWorkerIfAsked` before anything else, because a worker
  must not parse flags or open a store.
