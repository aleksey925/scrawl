# Search

The server's search and the note's find bar.

- Both have the same options, in the same order and on the same keys: Match
  case, Whole word, Regular expression and Fuzzy, `Alt+C`, `Alt+W`, `Alt+R` and
  `Alt+F`. With none of them on, the text is looked for as typed, in any case,
  and its accents count: `σπιτι` does not find `σπίτι`. Match case keeps the
  case too, and a regular expression is taken as written. Fuzzy is the loose
  search, and every loose rule is its own: it looks for words, with or without
  their accents and with a typo, so the plain search stays as exact as a person
  expects of it. Match case and Whole word mean nothing in Fuzzy and are
  disabled, and Fuzzy and Regex turn each other off.
- Each of the two keeps its options in local storage, the search with Titles
  only, so they hold for the next search and for every note, as editors keep
  theirs, and the device and the browser keep their own. Each opening reads
  them again, so a page Back brings from the browser's cache, or another tab,
  sees what was changed elsewhere. A search or a bar already open does not, and
  the last toggle pressed keeps the options it shows. A search result opens the
  find bar with the options of that search, for that time only: the find bar
  has to find what the server found, and what it keeps is left as it was. A
  toggle pressed on that bar changes only that option in what it keeps, and
  Fuzzy and Regex still turn each other off there.
- An accent is a nonspacing combining mark that Unicode gives to no script of
  its own (category Mn, script Inherited): the Latin, Greek and Cyrillic
  accents and the Arabic vowel marks, and not the zero width joiners, which are
  Inherited too. A letter whose canonical decomposition adds only accents is
  its base, so `ά` is `α` and `ё` is `е`. The vowel signs of Hindi or Thai, the
  nukta and the Hebrew points belong to their script and are not accents, so a
  query never requires one; Fuzzy still drops them from every word, as it drops
  every nonspacing mark, so there `कल` and `कुल` find each other. And `й`, `ї`
  and `ў` stay letters of their own, as Russian has `мой` and `мои`. The server
  and the find bar build the bases from the same rule, over the same letters:
  U+00C0 to U+2FFF, from `À`, the first letter with a mark, to the end of the
  alphabets, so the Japanese kana and the CJK characters are left as they are.
- Fuzzy takes every word to its bases, in the index and in the find bar, so
  `μεγαλο` finds `μεγάλο`. An accent the query types is kept: a word typed with
  one matches the words that carry it on the same letter, inside it or as a
  mark after it, and more accents are allowed. So `все` finds `все` and `всё`,
  `всё` finds only `всё`, `ü` finds `ǘ` and `ά` finds `ἄ`. The server checks
  the accents at each place a word stands before the words a prefix or a typo
  expands to are merged, and scores only those places, so a plain `cafe` in the
  text or a heading gives `café` no boost. It checks a title word by word, as a
  title has no places, and checks every word of a phrase. Only the first 30
  accents on a letter count, the limit of Unicode's stream-safe text, so a long
  run of marks cannot slow a search down.
- The plain search compares the characters as written. A mark belongs to the
  letter before it, so a match never ends on a letter whose accent it leaves
  out: `молоко` does not find `молоко́`, as `замок` does not find `за́мок` and
  `σπιτι` does not find `σπίτι`, though the stress mark of Russian is a
  character of its own. Regex is taken as written and may end before one. Whole
  word looks past a mark, and a mark after no letter, such as the one in the
  emoji `1️⃣`, is kept as typed. Any case also takes `ς` for `σ`, as a word in
  capitals ends in `Σ`, and a ypogegrammeni NFC leaves apart from its letter
  for `ι`, as Go and javascript fold it: `ᾱͅ` finds `ᾱι`. A Fuzzy result opens
  the find bar in any case, so there `ᾱͅ` marks `ᾱι` too, though Fuzzy did not
  find it.
- A typo is one letter added, dropped, changed, or two neighbours swapped. A
  word of up to three letters takes none, four to seven take one, eight and
  more take two, the scale most search engines use: a typo in a short word
  matches too many other words. An accent missing is never a typo, and an
  accent typed on another letter is one, as Fuzzy is there for mistakes: where
  no word has it on its letter, `замо́к` finds `за́мок`, and that word weighs as
  any word found with a typo. A word found with a typo needs only the accents
  typed somewhere in it, as its letters no longer line up, so a moved accent
  costs nothing on top of a changed letter: `замо́к` also finds `за́мак`, and two
  accents moved are one typo. The short `уже́` still does not find `у́же`. A word
  in quotes, alone or in a phrase, takes no typo, is no prefix and keeps every
  accent typed on its letter. A phrase is the server's: the find bar has none,
  so there each word in quotes is strict on its own, and a closing quote ends
  the prefix. A word with no match that carries its accents is the one that
  looks for typos, on the server among every word of the index, in the find bar
  among the words of the note. With Titles only, a match in the body alone is
  no match, so a title can still be found with a typo.
- Search is the server's. A result line is a line of the index's cleaned text
  with its line in the source, so a pattern matches the text as a reader sees
  it and never markdown syntax: `^Heading`, not `^## `
  ([ADR 9](../adr/0009-search-on-reader-text.md)). Fuzzy is the ranked word
  search, every word required and the last a prefix. A prefix takes the first
  50 words of the index it starts, itself first, so a short prefix with an
  accent can miss a word further on that the find bar marks. Exact and Regex
  scan that text with RE2 under a deadline, a cap on the pattern and a cap on
  matched lines, skip empty matches, and say when they stopped early. The
  server builds the url that opens a result with the note's find bar filled in,
  and for Fuzzy it is the whole words the postings matched, typos included. A
  request that names no mode is Exact, the way the app opens, and `snippet` is
  escaped HTML.
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
