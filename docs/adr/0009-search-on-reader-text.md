# 9. Search matches the text a reader sees

Status: accepted. Where it applies: [search](../design/search.md).

## Context

The index keeps a cleaned text of every note, without the markdown syntax.

## Decision

A result line is a line of that cleaned text, with its line in the source. A
pattern matches the text as a reader sees it and never the markdown syntax:
`^Heading`, not `^## `.

## Options turned down

- Keep the raw source as well: it would double the memory and find matches in
  URLs the note does not show.
