# Search

The server's search and the note's find bar.

- Both have the same options, in the same order and on the same keys: Match
  case, Whole word, Regular expression and Fuzzy, `Alt+C`, `Alt+W`, `Alt+R` and
  `Alt+F`. With none of them on, the text is looked for as typed, in any case
  and with or without accents, so a Greek word typed without its stress mark is
  found. Match case keeps the accents too, as a person who asks for the case
  asks for the text exactly. A regular expression is taken as written. Fuzzy
  looks for words: Match case and Whole word mean nothing there and are
  disabled, and Fuzzy and Regex turn each other off.
- An accent is any combining mark of a letter's canonical decomposition, so `ά`
  is `α` and `ё` is `е`, while `й`, `ї` and `ў` stay letters of their own, as
  Russian has `мой` and `мои`. A query letter becomes the class of every letter
  with the same base, followed by any combining marks, which also finds a
  stress mark written as a mark of its own, as in `молоко́`. A class keeps the
  offsets of the text, so the marks and the line numbers need no mapping, and
  the server and the find bar build it from the same rule, over the same
  letters: U+00C0 to U+2FFF, from `À`, the first letter with a mark, to the end
  of the alphabets, so the Japanese kana and the CJK characters are left as
  they are. Match case compares the characters as written, so `молоко` still
  finds `молоко́` and leaves the stress mark, a character of its own, out of the
  match. A mark belongs to the letter before it: Whole word looks past it, and
  a mark after no letter, such as the one in the emoji `1️⃣`, is kept as typed.
  Any case also takes `ς` for `σ`, as a word in capitals ends in `Σ`.
- A typo is one letter added, dropped, changed, or two neighbours swapped. A
  word of up to three letters takes none, four to seven take one, eight and
  more take two, the scale most search engines use: a typo in a short word
  matches too many other words. An accent is never a typo. A word with no exact
  match is the one that looks for typos, on the server among every word of the
  index, in the find bar among the words of the note.
- Search is the server's. A result line is a line of the index's cleaned text
  with its line in the source, so a pattern matches the text as a reader sees
  it and never markdown syntax: `^Heading`, not `^## `
  ([ADR 9](../adr/0009-search-on-reader-text.md)). Fuzzy is the ranked word
  search, every word required and the last a prefix. Exact and Regex scan that
  text with RE2 under a deadline, a cap on the pattern and a cap on matched
  lines, skip empty matches, and say when they stopped early. The server builds
  the url that opens a result with the note's find bar filled in, and for Fuzzy
  it is the whole words the postings matched, typos included. A request that
  names no mode is Exact, the way the app opens, and `snippet` is escaped HTML.
- `Cmd+F` on a note opens the reader's own find bar, in the app and in a site.
  It matches each block's visible text as one string, the way the index
  flattens a note, so a phrase across bold is one match, and marks the text
  nodes a match covers. Its Fuzzy marks every word that matches one of the
  words typed. Text an input method is still composing is searched as it is
  typed: Android's keyboard composes every word until a space. An Enter or Esc
  that ends a composition neither steps nor closes the bar. An empty match is
  skipped, and a closed `<details>` around the current match is opened. The
  match runs in a worker the app ends after a second, because a regular
  expression in javascript cannot be stopped from inside; a site has no worker,
  so there a pattern that came in the address waits for Enter. A search result
  hands its query, its options and its line over in the url the server built.
- On a phone the search and Find in note are cards over the keyboard at the
  bottom of the screen, placed by the visible area ([phone](../ui/phone.md)).
  The search there opens on the notes read last, which the browser keeps in
  local storage, with Clear to empty that list. With the reading copy a phone
  keeps the search, with the field disabled, and it shows only those notes, so
  they stay a tap away with no network; a desktop hides the search then, as the
  search is the server's.
