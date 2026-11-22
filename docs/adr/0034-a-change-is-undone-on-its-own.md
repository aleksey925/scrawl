# 34. A change in the history is undone on its own, beside Restore

Status: accepted. Where it applies:
[history](../design/history.md#undo-and-restore), [pages](../ui/pages.md).

## Context

Each version in the history shows the change it made, before and after, and
Restore under it brought back the text after the change. A person who read a
removed word on the left side pressed Restore to get it back, and on the newest
version Restore was disabled, since its text is the note's text now. The screen
showed a change, and its one button acted on a version.

## Decision

- Every version has two buttons. Undo this change takes out only the change the
  version made and keeps the ones after it. Restore this version brings the
  whole note back to the text of that version, as before.
- An undo is a three-way merge of text: `git merge-file` with the version's
  text as the base, the text on disk as ours and the text before the change as
  theirs. The text on disk is hashed into the repository first, as the merge
  reads objects. The result is written through `store` and recorded like a
  restore.
- A merge that conflicts is refused, with "later changes touched the same or
  nearby lines, restore a version instead". Nothing is resolved, and no
  conflict markers reach a note.
- Undo is disabled for a version with no change of text: the first one, a
  deletion and a rename alone.

## Options turned down

- Restore brings back the text before the change instead: on an older version
  it also throws away every later change, while the label promises one change.
- Undo only on the newest version: the older versions still show a change with
  a button that does something else.
- Labels alone, Restore as it was: the screen still shows a change and offers
  no way to take it out.
- A merge in Go: `git merge-file` is already on the machine, reads no attribute
  and runs no merge driver, and its result is the one git shows.
