# 13. Versions are compared as rendered HTML

Status: accepted. Where it applies:
[history](../design/history.md#comparing-versions).

## Context

The notes are formatted by prettier, and a reflow or a padded table changes
many source lines without changing what a reader sees.

## Decision

`htmldiff` takes the HTML `render` made of both sides, lines up the top-level
blocks by their visible text and marks the changed words inside a pair. A
reflowed paragraph, a padded table or a formatter's pass is a `format` row and
never rewritten text.

## Options turned down

- The source patch as the main view: a formatter's pass reads there as
  rewritten text. The patch stays as the `Source` view.
