# 10. What a reset loses is answered by a trial merge

Status: accepted. Where it applies:
[remote sync](../design/remote-sync.md#conflicts-and-reset).

## Context

A diverged copy can be reset to the remote version, and the reader is told
first whether that loses anything.

## Decision

The answer comes from a trial merge (`merge-tree`). A conflict means "something
is lost" by itself, whatever the merged tree shows. Anything not proved clean
keeps a backup branch.

## Options turned down

- A commit count. After a rebase or a squash upstream, every old commit still
  counts as ahead while its content is on the remote.

## Consequences

- A merge driver named by the repository runs during the trial merge, so
  `.git/info/attributes` sets `merge` beside the unset filter.
