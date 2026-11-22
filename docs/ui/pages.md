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
  the page's `⋯` opens, and on a phone the Outline button of the note's
  capsule. The sheet tints the current heading with the accent from edge to
  edge. A folder's list always runs the width of the room beside the sidebar,
  less up to 96px a side, whatever the page width: a table has no reading line
  to keep short and long names need the room. A text file that is not a note
  takes the same width, as its editor takes the whole room: code has long lines
  and no reading line either. The page's left edge moves between a note and a
  folder or a text file, and that is accepted.
- The topbar heads the page's column: the path at its left, the space first and
  the page's file or folder name last, `notes / deep / nested.md`, and the
  page's actions at its right. The last crumb is the name and not a note's
  title, so the editor shows the same crumb as the reader, and a rename's
  popover opens under the text it edits. The path comes from the page's own
  answer through one page chrome context, never from the URL alone, which holds
  no title for the phone's bar. The topbar stays at the top while the note
  scrolls, and beside the sidebar the page has no rubber band at its ends,
  which pulled the note away from the fixed sidebar; a phone has no sidebar and
  keeps the rubber band its own apps end a scroll with. The reader's top edge,
  where a heading lands and where the editor takes its position from, is the
  bottom of the topbar. History is among the actions only where the space
  records versions. In a writable remote space the sync control is always first
  in the topbar's group at the right, in the reader and the editor, just before
  the page's "Edited" date or the editor's save state, as Google Docs keeps its
  saved cloud by the document: when the note last changed and whether that
  change reached the remote read as one status. The control says where the
  person's changes are: a gray spinner while they are on their way, a gray
  cloud with a check once all is sent, an orange crossed cloud when something
  is not sent or not synced, and an orange warning sign when a person must act,
  because of a conflict with the remote or the remote refused its token. A
  read-only or local space shows the control only when something is wrong. The
  calm states have no word, so a save does not make the bar jump, and the
  problem states add one on a wide screen: Not synced, No connection, Conflict,
  Access refused. The editor of a phone has no sync control: the bar there is
  the way back, the name with the save state and Save, a problem of the space
  is the banner over the text, and Save leads to the reader, where the control
  is ([editor](editor.md)). No connection is a failed fetch, so it is not
  mistaken for a change that was not sent. "Synced" is the check that stays,
  with no toast and no timer, the way Notion keeps a small quiet state in its
  bar. A click on a calm state shows its word, Syncing or Synced, in a small
  dark tip centered under the button, as Notion draws one, with a gray line
  "This note is not sent yet" under it when the open note is not sent, and the
  offline mark shows its tip the same way; the button stays gray while its tip
  is open. A click on a problem state opens the facts behind it, in a popover
  as wide as its text and no wider than 320px, so a short state is not a
  half-empty box; a phone opens the same popover. In a conflict it lists the
  files under "Conflicting files:" and has no button: Replace local copy is in
  the banner, which every screen shows. Its dialog is the prototype's alert: a
  bold title ending in a question, gray text, the files on a gray ground with
  their icons, no colored callout and no close button, and a blue Replace,
  since nothing is lost. Under reduced motion the spinner is a still cloud with
  an arrow. A folder is always its list, the root included: a Notion database
  of Name, Size and Modified led by a `..` row, and a click anywhere on a row
  opens it. A right click on a row opens the menu the tree row has, at the
  pointer as a desktop has it, over the row's name and its selected text too,
  as a tree row does. It creates nothing: from a row a new entry was named in
  the tree, away from the list. On the free space of the page a right click
  opens a menu of New note and New folder, a note's draft and a row of the
  table for the folder; there a link, a button and selected text keep the
  browser's own menu, so text is still copied from there. The free space is the
  page, which grows to the bottom of the window. A row keeps the hover gray
  while its menu is up. A rename draws the field in the name cell of the row,
  on the gray a new row has, and the row then takes no click, no right click
  and no hover. New is a large main button at the right of the folder's title,
  where Notion puts New page: a click opens a note's draft, and the arrow
  joined to it opens a menu of New folder alone, as wide as its label, which
  puts a row with the field after the last folder. Its tip names the key `N`.
  The page has no `⋯` in the topbar: its Copy link, Rename, Move to and Delete
  are the row menu's, in the tree and in the list of the folder above, and a
  menu of a folder on its own page was a second place for them. There is no
  gray pill of the one view and no count of the items over the table: the pill
  switched nothing, and the count said what the rows show. The table is
  Notion's too: no line between the columns, which read as a spreadsheet, and
  columns of their own width, the name 530px and the others 150px, as a file
  name carries its extension, with an empty one at the end taking the rest and
  the row lines running across it, so a date is not a screen away from its
  name. Every column starts at its left edge, the size too: a size against its
  right edge stood against the date and the two read as one column. On a narrow
  page the name gives way. A column's header is gray text of the regular weight
  with a filled icon, as Notion heads one; 500 beside the system's own
  smoothing read bold, and an empty folder keeps the header with its empty
  state under it, a blue New note and a plain New folder. Its `index.md` is a
  row like any other, in its place by name, with a "Folder page" tag, and no
  readme is shown under the list; Home in the sidebar opens the root
  `index.md`, or the root's list when there is none. A folder holding two cases
  of `index.md` has no folder page, and a site refuses it, because both would
  be written to one file. A note that does not exist yet is a page too, its
  file name as a faint title and the ways on from there, the first of them,
  create it, on Enter. On a phone the bar on top holds `‹` with the folder
  above, the title once the page's own has scrolled under the bar, at once on a
  page that has none of its own, and the sync control at the right. The title
  there stays the note's title, since it stands for the heading that scrolled
  under the bar. The actions of a note or a file are in its capsule at the
  bottom ([phone](phone.md)). A rename of the page puts its field in the
  title's place across the whole bar, and the way back leaves the bar until it
  is done; the sync control stays after the field. The sync control is the icon
  alone on a phone: a word next to a title of half the bar did not fit. A tap
  on it opens its popover, as on a desktop, and Profile shows the same facts in
  its Sync group ([phone](phone.md)). The root has no way up, and the app's
  logo and the space's name stand there instead, with no large title under the
  bar, which said the space's name a second time. Recent and Profile, the first
  screens of a tab, have no way up and no swipe either, as the first screen of
  a tab of iOS has none. Every screen has the bar as a row of its own: a root
  drawn another way made the page jump on the way to a folder. A folder has its
  title on one line under the bar. A folder there is a list and not a table: a
  row is the icon and the name on one line, with no size, date or count, no
  chevron, and no `..` row.

## Note

- A picture of the space in a note carries its width and height, read by the
  server from the head of the file through `store`, so the page keeps its room
  before the picture comes and the text under it does not jump. That is PNG,
  JPEG, with the sides swapped when its EXIF turns it a quarter, and GIF; an
  SVG or a WebP has no size read, and the text still moves when it loads. At
  most 1 MiB of the head is read, so a picture with more metadata before its
  size gets none. The size is part of the rendered note, kept as long as the
  note is, so a picture replaced by one of another size keeps the old room
  until the note changes, as the mark of a broken link does. A page of the
  command line and a site read no sizes.
- A task box on the page is disabled, as GitHub shows a file and unlike Notion.
  A task is ticked in the editor and saved like any change, because a click on
  the page would be a write, and every tick a commit and a push.
- A heading's link mark is a `#` after its text, as Docusaurus has it, and
  copies the full address of its section and says so in a toast. It is text of
  the heading's own font and size, weight 400, 0.18em after the last letter. At
  300 beside the bold text it looked smaller than the letters. It sits 0.03em
  under the baseline: round letters go a little below it and the `#` does not,
  so on the baseline itself it looked raised. An icon of its own size never sat
  right beside the letters: centered on the capitals it hung at the top, and on
  the lowercase letters it still read as a mark apart from the text. The `#` is
  drawn by CSS and is not in the heading's text, so it is not copied with it
  and the find bar does not match it. It is kept with the last word: alone on a
  new line it read as a stray mark. It is in the tertiary text color, and in
  the text color under the pointer: in the secondary color, near the heading's
  own, it read as part of the last word. With a pointer it shows when the
  heading is hovered or holds the focus; a touch screen has no hover, so there
  it always shows, a phone included, with a tap area of the full tap size. At
  the left of the heading it hung outside the text with nothing to say what it
  did, and a phone had no room for it.
- A quote's bar starts where the text of the note does, 2px in, like a rule,
  and so does a table's border, which also ends 2px before the right edge of
  the text. At the page's edge they stuck out of the text's line. In a list
  item, a quote or a details block a table lines up with the text around it.
- A numbered list keeps 2em for its numbers, as GitHub has it, and so do the
  footnotes; a bulleted list keeps 1.7em. A number ends where its item's text
  starts, so `10.` reaches further left than `9.`, and in 1.7em it stuck out of
  the text's line. A three-digit number still reaches past that line, as on
  GitHub. A task box sits at the same place in both kinds of list.
- A block of code has a head row inside its box, the language at the left as
  the fence names it, or `text` with none, and Copy at the right, above the
  code and never a layer over it: a layer covered the end of a long first line.
  Copy is an icon that always shows, and turns to a green tick for a moment
  after a copy. Copy takes the text of the `pre` and nothing else, so the head
  is never inside it.
- A long line scrolls inside the box and never wraps. The browser's own
  scrollbar is hidden: a thin bar under the code shows where the view is while
  the code scrolls and fades out soon after, and the code fades out at an edge
  that has more behind it. A block that fits has neither. The bar keeps its
  room when hidden, so the code never jumps when it shows.
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
  Notion has it, with the next step as a button. A blank screen read as a page
  that failed to load. In the tree an empty folder has no arrow and no line of
  its own, and an empty space shows no rows under its name, see
  [sidebar](sidebar.md).

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
  The size is read, and a diagram fitted, in fractions of a pixel: in whole
  pixels a narrow, tall picture was a few percent off, and a very wide, low
  diagram lost its shape, so its actual size was wrong. On a touch screen two
  fingers pinch and a double tap toggles, and a single tap on the picture does
  nothing, so the first tap of a double tap does not close it. A zoomed picture
  is dragged by one finger or the mouse and never leaves a gap at an edge. A
  swipe steps to the next picture only when it is not zoomed, and a step fits
  the next one. A picture not zoomed is pulled up or down by one finger, as a
  phone's photos are: it follows the finger, the dark ground fades and the
  tools hide. Let go past 100px or with a flick, it leaves the screen that way
  and the viewer closes; otherwise it slides back. A flick counts only while
  the finger still moves as it lets go, and a second finger stops the pull and
  pinches. The ground fades only where the `::backdrop` reads the dialog's
  custom properties ([quirks](../quirks.md#browsers)). The dialog takes
  `touch-action: none`, or the browser zooms the page under it instead.
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
  Undo and Restore below them. The tag says how a version was made when it was
  not in the app (API, On disk) and otherwise what it did (Create, Edit,
  Rename, Delete). Closing it goes to the note. A button beside the close one
  expands it to the window less 16px a side, and the choice is kept. The change
  of size is part of mantine's own transition, because mantine writes that one
  inline and it outranks the stylesheet. The server says which versions can be
  restored, in `restorable`: never a deletion and never the text the file has
  now, hashed the way git names a blob. It says which can be undone in
  `undoable`: never the first version, a deletion or a rename alone. The client
  read it off the blob and the row's place once, and the newest row stops being
  the current text the moment the file changes on disk. On a phone the history
  is a sheet of nearly the screen's height, "History" and the count of versions
  over the file's name, and each version a card with its time, marked current
  for the text the file has now, the initial and the name of who made it, a
  user, a token's name or "outside the app", the colored tag, and "as" and the
  old path when the file moved. The picked card, the first one at the start,
  opens to show the switches of Rendered and Source and of Split and Unified,
  the change, then "Undo this change" in the secondary color over "Restore this
  version" in the accent. On a desktop the same two stand below the versions,
  Undo in the default look over Restore filled. Undo takes out only the change
  the version made and keeps the later ones, and Restore brings the whole note
  back to the version. A line under each says what it does, or why it is
  disabled, and both are hidden without the right to write. Undo is disabled
  while the note is deleted, as there is no text to take the change out of. An
  undo whose lines were changed again later is refused in a toast. Each asks
  first, the address stays `/history/<path>`, and the ✕ goes back to the note.

## An HTML app

- The page of a `.html` or `.htm` file has Run among its actions, a play icon
  after Edit and before Download, and on a phone the first button of the file's
  capsule, at any address: where Run cannot work the run screen says why, or a
  toast when Run opens a tab of its own. See
  [HTML apps](../design/html-apps.md).
- In the list of a folder a `.html` or `.htm` file has a Run button in its row,
  an outlined RUN in capitals after the name, as Notion draws Open; on a phone
  it is a filled pill, `Run` in plain case, before the row's menu, its tap area
  the 44px of a tap. On a touch screen both take a tap area and the pressed
  tone of their own, the pill the 44px and the RUN of a tablet's table the
  row's height, as a taller one would take taps from the rows beside, and to
  the sides only the gap between it and the name, which keeps its own taps, and
  the row under them stays as it is, as for its menu button. The menu of such a
  row has Run after Open. Both do what the Run of the file's page does. A site
  has neither, as it has no run screen.
- A folder whose own files include one named exactly `index.html` has the same
  Run in its row and Run after Open in its menu, on a desktop and a phone, and
  they run that `index.html`. Its name still opens the folder, and the rest of
  the menu acts on the folder. `index.htm`, another case, a folder or a symlink
  with that name, and an `index.html` deeper down give no Run. The tree of the
  sidebar has no Run on a folder.
- Run opens the run screen, `/run/<path>`, outside the layout: no sidebar, no
  topbar, no tab bar and no banner, since the app wants the whole screen. One
  bar on top holds Back, the file name with an ellipsis, and Open in a new tab.
  Back is the arrow alone, drawn as the way up of the reader is, 20px in the
  secondary color and dim while pressed. On a phone the bar is as tall as the
  other bars there, 48px, with the name at 16px. The name of an `index.html`
  below the root is its folder's: `todo-app`, not `index.html`, whether the
  file's Run or the folder's started it. The frame fills the rest with no
  border. Back goes to the screen Run was tapped on, the file's page or the
  folder's list, kept in the state of the run screen's entry in the history; a
  run screen opened by its address goes back to the file's page. Back never
  steps back in the history: the frame's own pages go into the tab's history,
  and a step back could land on an earlier page of the app.
- In Safari, on a Mac and on an iPhone, every Run opens the app as Open in a
  new tab does, and the screen Run was tapped on stays under it; in an app from
  the home screen the tab is a browser view over scrawl, whose close goes back.
  See [HTML apps](../design/html-apps.md#safari). Every browser does the same
  when scrawl is on plain `http` at an address of the network, any host but
  `127.0.0.1`, `localhost` and `*.localhost`; the 409 of such an address with
  no `MINI_APPS_URL` comes in an error toast and the tab closes. See
  [plain http](../design/html-apps.md#plain-http-on-a-network).
- Open in a new tab asks a new ticket in the tap and opens the app in a tab of
  its own; a blocked popup shows an error toast. With no network it opens the
  address of a kept app, and is disabled when the app is not kept.
- An error of the ticket shows its text under the bar with a link Back to where
  Run was tapped, the reason and the fix at an address with no `MINI_APPS_URL`
  included. A failure after the ticket shows inside the frame: the browser's
  error page, or the text of a refused cookie,
  `To use this app, sign in to scrawl and open it from there.`
- The frame stays when the network goes and comes back, so the app keeps its
  state and what was typed in it.
- With no network and the copy on, a kept app opens in the frame. Else the
  screen shows `Needs a network` with one of
  `This browser does not keep this mini app for offline use.`,
  `Run this mini app once with a network to use it offline.`, or, with the copy
  off, the text every page has.

## Start

- Until the app has drawn its first screen, the page is the theme's ground with
  nothing on it, both before the bundle runs and while the first page's chunk
  loads. Opened from the offline copy, the page has the system's ground until
  the bundle runs, since that shell knows no theme
  ([ADR 33](../adr/0033-no-logo-while-the-app-loads.md)).
- With offline access on, the app opens on the copy at once and turns writable
  when the server answers. See [offline copy](../design/offline.md).

## With no network

- With offline access on and no network, the topbar's group at the right starts
  with a mark: the crossed wifi icon, with "Offline" beside it on a wide screen
  and alone on a phone's bar on top, apart from the phone's editor, which shows
  neither the mark nor the sync control: the cells beside the name have no room
  for it, the draft keeps the text on the device, and a save with no network
  shows its toast ([editor](editor.md)). A click shows `No network` and, under
  it in gray, `Last sync 14:30`, the time of the copy on the device.
- The pages read the copy on the device. Every write control, history, the
  search of a desktop and the sync control are gone, a phone's search shows
  only the recent notes ([phone](phone.md)), the tree's filter stays, and the
  note's menu loses Export as Markdown and as HTML; Export as PDF, which is a
  print, and what reads only the page stay. A note or a file the copy does not
  hold says `This is not on this device`.
- `/edit/`, `/history/` and `/search` opened with no network show
  `Needs a network`, with a link back to the note, or to all notes from
  `/search`. An editor that was open when the network went stays open, so no
  typed text is lost; its save fails the way it fails today.
- The mark goes, and the controls come back, only once the server answered who
  the person is. See [offline copy](../design/offline.md).
