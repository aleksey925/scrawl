# 27. The contents is refreshed by the editor

Status: accepted. Where it applies: [editor](../ui/editor.md).

## Context

The contents button writes a list of the headings between `<!-- toc -->` and
`<!-- tocstop -->`. The list went stale as soon as a heading changed, and only
a second press of the button brought it back. A note can be written by the
editor, by a client with an API token, and by a restore from the history.

## Decision

- A save from the editor brings the list up to date before it formats and
  writes: it asks `POST /api/preview` for the headings and puts a fresh list in
  the first block. A note with no heading left keeps its markers with nothing
  between them.
- A save never adds a block where there is no start marker.
- If the answer fails or takes more than three seconds, the note is saved as
  written and a toast says so.
- The cost: the text between the markers belongs to the editor, so an edit made
  there by hand is lost on the next save, and a save may wait up to three
  seconds for the headings.
- A write with an API token and a restore store the text they were given.

## Options turned down

- The server refreshes the list on every write, as it formats with
  `formatOnSave`: an API client and a restore would get text other than what
  they sent, and a restore would no longer give back the old version as it was.
- Leave the list to the button: the list stays stale until someone remembers to
  press it.
- Keep the old list when no heading is left, as the button does: a list of
  links to headings that are gone is wrong on the page.
