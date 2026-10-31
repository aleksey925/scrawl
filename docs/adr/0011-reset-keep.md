# 11. The reset is `reset --keep` plus a check of our own

Status: accepted. Where it applies:
[remote sync](../design/remote-sync.md#conflicts-and-reset).

## Context

`reset --keep` refuses to write over an uncommitted change. Git still replaces
an _ignored_ untracked file without a word, and the store serves files that a
`.gitignore` among the notes names.

## Decision

The reset is `reset --keep`, and before it every path the remote adds is looked
up on disk. One that is there and untracked refuses the reset.

## Options turned down

- `reset --hard`: it writes over an uncommitted change, which `--keep` refuses
  to do.

## Consequences

- A writable space commits what is on disk before the backup is taken. A
  pull-only space never commits, so there the refusal is the whole protection.
