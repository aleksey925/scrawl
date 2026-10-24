# Editor

The editor screen.

- The editor is the page and not a box on it: a row of tools over the text,
  split by thin lines into groups, and the source in a column the width of the
  note with line numbers beside it. The source reads as text with its markup
  set back: the words in the text color, a heading and bold by weight, the
  marks around them faint, a link in the accent. The topbar holds the state of
  the save, the layout as Source, Split or Preview, Cancel and Save; on a phone
  Cancel and Save are the two ends of the bar.
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
- The editor toolbar is a strip that moves sideways only and stops at its ends,
  and the editor screen takes the page's rubber band away. Left to the defaults
  the strip followed a finger up and down with the page behind it. It has no
  scrollbar, so an end with more buttons behind it fades.
