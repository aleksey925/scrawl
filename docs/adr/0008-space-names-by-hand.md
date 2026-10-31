# 8. A space's name is written down by a human

Status: accepted. Where it applies:
[server](../design/server.md#spaces-and-settings).

## Context

A space is served under `/s/<name>/`, so its name is part of every URL of every
note in it.

## Decision

The name is always given: `--space.name` and `name:` in the spaces file are
mandatory.

## Options turned down

- A name derived from the directory: an `mv` of the directory would become a
  site-wide URL change.
