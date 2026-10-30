# Pages

The page beside the sidebar: the note, the topbar, the folder list and what
opens over them.

## Layout

- Every screen is one white page in the room beside the sidebar, with no card
  around it, and 16px sides on a phone. A note is one column of one width, its
  tables and code included: 720px by default, as Notion has it, or 960px, or
  the room less 96px a side, by the reader's choice in the note's `⋯` menu,
  kept in the browser. Two widths in one note, a narrow text with wide tables,
  read as a mistake. The outline floats at the right edge as a column of short
  dashes, and its list opens under the pointer or the focus; a line beside the
  text read as a second column of text. Below the width it needs it is a sheet
  the page's `⋯` opens. A folder's list always runs the width of the room
  beside the sidebar, less up to 96px a side, whatever the page width: a table
  has no reading line to keep short and long names need the room. The page's
  left edge moves between a note and a folder, and that is accepted.
- The topbar heads the page's column: the path at its left, the space first and
  the page's own title last, and the page's actions at its right. The path
  comes from the page's own answer through one page chrome context, never from
  the URL alone, because only the answer knows a note's title. The topbar stays
  at the top while the note scrolls, and beside the sidebar the page has no
  rubber band at its ends, which pulled the note away from the fixed sidebar; a
  phone has no sidebar and keeps the rubber band its own apps end a scroll
  with. The reader's top edge, where a heading lands and where the editor takes
  its position from, is the bottom of the topbar. History is among the actions
  only where the space records versions. A folder is always its list, the root
  included: a Notion database of Name, Size and Modified led by a `..` row, and
  a click anywhere on a row opens it. New, a file or a folder, is a large main
  button at the right of the folder's title, where Notion puts New page. The
  table is Notion's too: its one view a gray pill with no line under it, no
  line between the columns, which read as a spreadsheet, and columns of their
  own width, the name 530px and the others 150px, as a file name carries its
  extension, with an empty one at the end taking the rest and the row lines
  running across it, so a date is not a screen away from its name. Every column
  starts at its left edge, the size too: a size against its right edge stood
  against the date and the two read as one column. On a narrow page the name
  gives way. A column's header is gray text of the regular weight with a filled
  icon, as Notion heads one; 500 beside the system's own smoothing read bold,
  and an empty folder keeps the header with its empty state under it, one plain
  New file button. Its `index.md` is a row like any other, in its place by
  name, with a "Folder page" tag, and no readme is shown under the list; Home
  in the sidebar opens the root `index.md`, or the root's list when there is
  none. A folder holding two cases of `index.md` has no folder page, and a site
  refuses it, because both would be written to one file. A note that does not
  exist yet is a page too, its name as a faint title and the ways on from
  there, the first of them, create it, on Enter. On a phone the bar on top
  holds `‹` with the folder above, the title once the page's own has scrolled
  under the bar, at once on a page that has none of its own, and the page's
  `⋯`. The root has no way up, and the app's logo and the space's name stand
  there instead. Every screen has the bar as a row of its own and its title on
  one line under it: a root drawn another way made the page jump on the way to
  a folder. A folder there is a list and not a table: a name over one line of
  what it is, and no `..` row.

## Note

- A task box on the page is disabled, as GitHub shows a file and unlike Notion.
  A task is ticked in the editor and saved like any change, because a click on
  the page would be a write, and every tick a commit and a push.
- A block of code has a head row inside its box, the language at the left and
  Copy at the right, above the code and never a layer over it: a layer covered
  the end of a long first line. With a pointer Copy shows under it and under
  the focus; a touch screen has no hover, so there it always shows. Copy takes
  the text of the `pre` and nothing else, so the head is never inside it.
- A PlantUML diagram takes PlantUML's own dark mode in a dark theme, unless it
  sets colors of its own: a color on an element, a `skinparam` color, also one
  inside a `skinparam` block, a `<style>`, a `<back:>`, a text color in
  `<color:navy>` or `<font color=navy>`, a `!theme` or a library from
  `!include <...>`. Such a diagram is drawn as its author made it, light, on a
  card of the theme's `diagramPaper`. PlantUML's dark mode turns only its own
  colors dark, so its light text landed on the author's light fills and could
  not be read. A `#` in a label, a quoted text or a title, as in `closes #123`,
  is not a color.
- Nothing selected is shown as nothing. An empty note, an empty folder and an
  empty preview each say what they are through `EmptyState`, a gray title as
  Notion has it, with the next step as a button, and an open folder with no
  notes says so in the tree. A blank screen read as a page that failed to load.
  The tree row says "No notes inside" and not "Empty", because the tree lists
  only markdown and a folder of pictures is not empty.

## Over the page

- The picture viewer is a native modal `<dialog>` and not a mantine `Modal`.
  The browser keeps the page behind it inert, closes it on Escape and gives the
  focus back, and a click beside the picture lands on the dialog itself and
  closes it. The full-screen `Modal` had no backdrop to click and closed only
  on its cross. The dialog sits on the body, so `DocumentHtml` closes it
  together with the note. A picture's own page opens the same viewer, and shows
  the picture on the page itself with no box or checkerboard behind it. The
  picture gives way to its caption and is not capped in `vh`: with mobile
  Safari's bars out, the two stood taller than the dialog and were cut off.
- The viewer zooms. A click on the picture zooms to its full size at that point
  and a second click fits it back. A trackpad pinch, and the wheel with Ctrl or
  Cmd, zoom around the pointer; the wheel alone and a two-finger swipe move a
  zoomed picture, as they scroll a page: when the swipe zoomed, every move up
  or down on a trackpad zoomed instead. `+`, `-`, `0` and `1` zoom from the
  keyboard. A bar at the bottom zooms out and in, fits back, and shows the zoom
  against the picture's own size; a click on that number shows the actual size.
  The size is read in fractions of a pixel: in whole pixels a narrow, tall
  picture was a few percent off. On a touch screen two fingers pinch and a
  double tap toggles, and a single tap on the picture does nothing, so the
  first tap of a double tap does not close it. A zoomed picture is dragged by
  one finger or the mouse and never leaves a gap at an edge. A swipe steps to
  the next picture only when it is not zoomed, and a step fits the next one.
  The dialog takes `touch-action: none`, or the browser zooms the page under it
  instead.
- A diagram, mermaid or PlantUML, is never wider than the note: a wider one is
  drawn smaller, and opens in the same viewer, alone: it does not step to the
  note's other diagrams, as each stands in its own place in the text, and a
  step took the reader away from it. A click or a tap on it opens it, and with
  a pointer an Open button shows in its corner on hover; a touch screen has no
  hover, and there the tap is the way in, as for a picture. A link inside a
  diagram stays a link. The viewer fits the diagram to the screen on a sheet of
  the page's color, or on the card of a diagram with colors of its own: its
  lines are drawn for the page, and on the dark backdrop alone a light page's
  diagram disappeared. A diagram is vector, so it zooms to twice its own size
  even when that is more than eight times the fitted one.
- A diagram not drawn yet hides its source, which only flashed before the
  picture. A card with a moving shine and a diagram icon stands in its place
  from the first frame: an empty place read as a page that broke. The card is
  the height of the source, between 120px and 320px. Each diagram replaces its
  card as soon as it is drawn, and a mermaid one does not wait for PlantUML's
  engine to load, nor PlantUML for mermaid's. A diagram that could not be drawn
  shows its source again under the error, and one drawn again for a new theme
  keeps the old picture until the new one is ready.
- History is a large dialog over the note at `/history/<path>`, so a link and
  Back still reach it: what the picked version changed on the left, the
  versions with the colored initial of their author and a tag on the right,
  Restore below them. The tag says how a version was made when it was not in
  the app (API, On disk) and otherwise what it did (Create, Edit, Rename,
  Delete). Closing it goes to the note. A button beside the close one expands
  it to the window less 16px a side, and the choice is kept; on a phone it is
  the whole screen anyway. The change of size is part of mantine's own
  transition, because mantine writes that one inline and it outranks the
  stylesheet. The server says which versions can be restored, in `restorable`:
  never a deletion and never the text the file has now, hashed the way git
  names a blob. The client read it off the blob and the row's place once, and
  the newest row stops being the current text the moment the file changes on
  disk.
