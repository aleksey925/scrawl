# Editor

The editor screen.

- The editor is the page and not a box on it: a row of tools over the text,
  split by thin lines into groups, and the source in a column the width of the
  note with line numbers beside it. The source reads as text with its markup
  set back: the words in the text color, a heading and bold by weight, the
  marks around them faint, a link in the accent. Long lines wrap; the wrap
  button turns that off and keeps the choice. Then a long line scrolls sideways
  inside the column, and in Source the editor box is the column itself. When
  the box was as wide as the screen, a long line ran across the whole screen.
  The line numbers have the page's ground and so does the strip left of them,
  so a line scrolled sideways slides under them; on a transparent ground the
  text ran over the numbers. The topbar holds the state of the save, the layout
  as Source, Split or Preview, Cancel and Save; on a phone Cancel and Save are
  the two ends of the bar.
- A text file that is not a note is edited as text alone: the source, colored
  by its language, with Save, Cancel and the wrap, and no modes, toolbar,
  preview, formatter or picture upload, none of which means anything for it. It
  is the same editor screen with the markdown parts left out, not a second one:
  the save, the draft, the conflict and the guard on leaving stay one flow. A
  copy kept from a conflict keeps the file's extension, and a file that is text
  by its whole name, a `Makefile` or `go.mod`, gets a `.txt` copy, which the
  editor still opens. The language comes from the name: codemirror's set, and
  for what it lacks or guesses wrong the closest language it holds, in
  `web/src/editor/codeLanguages.ts` (a svelte component as html, elixir as
  ruby, a makefile as shell). No new grammar is a dependency of ours, so a name
  with nothing close (terraform, graphql, zig) stays plain.
- The contents button puts a list of the headings up to level 4, all but the
  title, nested by level, as links to them, after the line the cursor is on,
  between `<!-- toc -->` and `<!-- tocstop -->`. The title is the first heading
  of level 1 wherever it stands, the one the page takes its title from. A
  second press finds that block and writes a fresh list in its place. A
  `<!-- toc -->` with no `<!-- tocstop -->` after it, before the next start, is
  filled in where it stands, and a stop pairs only with the nearest start
  before it, so no text between two stray markers is lost. A marker is a
  comment on a line of its own; one inside a code block is text and not a
  marker. The editor finds both in the syntax tree it colors the text with. The
  list comes from the server: `POST /api/preview` answers with `toc`, the
  headings of the text with their ids and without the title, next to `html`. So
  a link opens its heading even where two headings share a name, and the
  levels, the title and the ids stay the server's; a copy of them in the
  browser would drift from it. A heading the render gives no id, one whose slug
  is longer than 129 characters or starts with `-`, has nothing to link to and
  is left out. An entry reads as its heading does on the page, an emoji as its
  glyph, math as its TeX source and a line break as a space. The list is built
  from the text sent to the server: if the text changed before the answer came,
  it is sent again, three sends at most, and then a toast asks to press the
  button again. A new press drops the answer to the one before it. If the
  source closes before the answer comes, as on a switch to Preview, the list
  still goes into the text, after the line the cursor was last on. A note with
  no heading under its title gets a toast and no change. The markers are
  comments, which the page never shows.
- The editor toolbar is a strip that moves sideways only and stops at its ends,
  and the editor screen takes the page's rubber band away. Left to the defaults
  the strip followed a finger up and down with the page behind it. It has no
  scrollbar, so an end with more buttons behind it fades.
