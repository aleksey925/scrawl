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
  text ran over the numbers. The topbar holds the sync control, the state of
  the save, the layout as Source, Split or Preview, Cancel and Save; on a phone
  Cancel and Save are the two ends of the bar and the sync control stands
  between them, in the middle, so a change on its way shows right after a save.
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
  title, nested by level, as links to them, after the block the cursor is in,
  between `<!-- toc -->` and `<!-- tocstop -->`. The block is the top-level one
  in the editor's syntax tree: a paragraph, a list, a table, an HTML block, a
  quote or a code block, so the list never splits one. A `$$` math block runs
  to its closing `$$` as the server reads it, blank lines and all. With the
  cursor in the front matter the list goes after it, and with the cursor on a
  blank line between two blocks it goes there. The title is the first heading
  of level 1 wherever it stands, the one the page takes its title from. A
  second press finds that block and writes a fresh list in its place. A
  `<!-- toc -->` with no `<!-- tocstop -->` after it, before the next start, is
  filled in where it stands, and a stop pairs only with the nearest start
  before it, so no text between two stray markers is lost. A marker is a
  comment on a line of its own; one inside a code block or the front matter is
  text and not a marker. The editor finds both in the syntax tree it colors the
  text with. The list comes from the server: `POST /api/preview` answers with
  `toc`, the headings of the text with their ids and without the title, next to
  `html`. So a link opens its heading even where two headings share a name, and
  the levels, the title and the ids stay the server's; a copy of them in the
  browser would drift from it. A heading the render gives no id, one whose slug
  is longer than 129 characters or starts with `-`, has nothing to link to and
  is left out. An entry reads as its heading does on the page, an emoji as its
  glyph, math as its TeX source and a line break as a space. The list is built
  from the text sent to the server: if the text changed before the answer came,
  it is sent again, three sends at most, and then a toast asks to press the
  button again. A new press drops the answer to the one before it. If the
  source closes before the answer comes, as on a switch to Preview, the list
  still goes into the text, after the block the cursor was last in. A note with
  no heading under its title gets a toast and no change. The markers are
  comments, which the page never shows.
- The editor toolbar is a strip that moves sideways only and stops at its ends,
  and the editor screen takes the page's rubber band away. Left to the defaults
  the strip followed a finger up and down with the page behind it. It has no
  scrollbar, so an end with more buttons behind it fades.
- The table button opens a menu that depends on where the cursor is. On any
  line of a table, the delimiter row included, it holds the edits of that
  table: add a row above or below or a column to the left or right of the cell
  with the cursor, and delete that row, that column or the whole table; on the
  delimiter row they act on the header row and the column under the cursor.
  Anywhere else it holds a grid of 8 by 8 cells that inserts a table, and
  nothing else: an edit that cannot apply there was only noise, grayed out. The
  grid lights the cells from its corner to the one under the pointer and names
  the size under it, columns by rows, the header counted as a row; a click
  inserts that size. On a touch screen a finger drags across the grid and the
  table goes in when it lifts, so a tap inserts the cell tapped; the grid takes
  the touch end itself, as the click after it lands on what is under the closed
  menu ([quirks](../quirks.md#phones-and-touch-screens)). The grid has the
  focus when the menu opens, the arrow keys move the lit corner, and Enter or
  Space inserts. The table goes after the line of the cursor, or on it when it
  is blank, with a blank line on each side, and the cursor goes to its first
  cell. In a table, the header has no row above it and cannot be deleted, as a
  table cannot be without one, and the last column cannot be deleted either;
  those items are grayed out. An edit writes the whole table again with its
  columns padded to one width and the alignment of each kept, the way prettier
  writes it, though a width here counts characters, so a column with CJK or
  emoji is padded less than prettier pads it; a row shorter than the longest
  gets empty cells, so no text is lost. Delete table takes the table's lines,
  and the blank line under it when there is one on each side. A table in a
  quote or a list keeps the marks in front of each line, and a new row takes
  those of the row it was added next to, or those of the delimiter row when it
  goes under the header, as the header's own can start a list item. The cells
  come from splitting each line on a `|` with no `\` right before it, after the
  first and the last `|` of the line are dropped, as the server reads them.
- The table menu is simple on purpose. It finds a table, and the place for a
  new one, the way the editor colors the source, and has no rules of its own
  for the markup around it. It only adds or changes markup and never checks it
  against the page: the editor and the server read some rare markup differently
  ([quirks](../quirks.md#react-mantine-and-the-editor)), so an edit there can
  land in a code block or change lines the page does not show as a table. Such
  an edit is in plain sight, Undo takes it back, and nothing is written before
  Save. Matching the server in the browser took a copy of its block rules that
  grew with every case found and still missed some.
