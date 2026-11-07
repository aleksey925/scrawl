# 21. Notes are wrapped at 79 columns

Status: accepted. Where it applies: [formatter](../design/formatter.md).

## Context

Prettier ran with its default options, which keep prose as it was written, so a
paragraph typed in the editor was stored as one long line. A diff of such a
note in the history marked the whole paragraph changed for one word, and the
note read badly in a terminal or another editor.

## Decision

Both copies of prettier run with `proseWrap: always` and `printWidth: 79`. A
paragraph is wrapped at 79 columns on every save, and short lines of one
paragraph are joined up to the width.

## Options turned down

- `proseWrap: preserve`, the default: a note keeps the line breaks its writer
  typed, but a paragraph from the editor stays one line and every diff of it is
  the whole paragraph.
- Another width, 80 or 100: 79 is the width the docs of this project are
  wrapped at, and it leaves a column for a diff's mark in an 80-column
  terminal.

## Consequences

- A note saved before the change is rewrapped on its next save, and that save
  shows in the history as a large change.
- A word, a link or code is never split, so such a line stays longer than 79.
