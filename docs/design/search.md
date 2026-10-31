# Search

The server's search and the note's find bar.

- Search is the server's. A result line is a line of the index's cleaned text
  with its line in the source, so a pattern matches the text as a reader sees
  it and never markdown syntax: `^Heading`, not `^## `
  ([ADR 9](../adr/0009-search-on-reader-text.md)). Fuzzy is the ranked word
  search, the last word a prefix and one typo allowed in a word of four runes
  or more. Exact and Regex scan that text with RE2 under a deadline, a cap on
  the pattern and a cap on matched lines, skip empty matches, and say when they
  stopped early. The server builds the url that opens a result with the note's
  find bar filled in, and for Fuzzy it is the whole words the postings matched,
  typos included. The API only grows: a request that names no mode or toggle is
  answered the way it always was, and `snippet` stays escaped HTML.
- `Cmd+F` on a note opens the reader's own find bar, in the app and in a site.
  It matches each block's visible text as one string, the way the index
  flattens a note, so a phrase across bold is one match, and marks the text
  nodes a match covers. An empty match is skipped, and a closed `<details>`
  around the current match is opened. The match runs in a worker the app ends
  after a second, because a regular expression in javascript cannot be stopped
  from inside; a site has no worker, so there a pattern that came in the
  address waits for Enter. A search result hands its query, its options and its
  line over in the url the server built.
