# Phone

How the app works on a phone.

- On a phone the controls sit at the bottom, under the thumb: a bar of five
  cells: Notes, Search, the action, Recent, Profile. The action is Edit on a
  note or a text file, a faint disabled Edit on any other file, so the cell
  keeps its place from a note to a picture, and New on every other screen. It
  is drawn in the gray of the tabs, a disabled Edit fainter, and with no right
  to write there is no cell and the four tabs share the width. The current tab
  is the accent, its icon filled and its label in the 600 weight, with nothing
  drawn around it, as iOS draws its tab bar; a dark current tab looked heavy on
  white and did not stand out. Only Notes, Search and Recent are ever current:
  New and Profile open something and are actions, not places
  ([ADR 29](../adr/0029-the-current-tab-is-the-accent.md)). A note has no New:
  a note is made from a list. A round Edit button over the page covered the
  text under it and was one more thing on the screen
  ([ADR 28](../adr/0028-edit-in-the-bar-new-as-tiles.md)). Profile opens the
  space's menu, the one the sidebar's foot opens: in the bar on top it was on
  the root alone. Its "Offline access" row is the same as in the sidebar's
  menu, and with no network the tabs keep only Notes, Recent and Profile. A tap
  on Notes or Recent where the page already is scrolls it to the top, as a tab
  of iOS does, and elsewhere opens the tab's page. The bar stays put while the
  page scrolls, as an app's tab bar does: put away on a scroll down, it read as
  the toolbar of a browser. A page ends at the bar, so a list that fits the
  screen does not scroll. Nine controls and the crumbs once shared one row on
  top, and the crumbs got 25px, wrapped and fell over the note as a column. A
  menu opens beside the control that opened it, the way a phone's own menus do;
  drawn as a sheet from the bottom, every menu sat apart from its button. The
  search and the history take the whole screen and the outline is a sheet, each
  over the bar. The search keeps its field at the bottom, over the keyboard,
  with the results above it: a field at the top of a tall phone is out of the
  thumb's reach. The editor has no tab bar, and a site has none: the editor of
  a note keeps one strip of its own at the bottom, its layout tabs, and while
  text is typed the formatting toolbar over the keyboard in their place
  ([editor](editor.md)). The search field is placed by the visible area of the
  screen, not by CSS alone: a phone's keyboard covers the bottom of the page
  without making it shorter, and a field fixed to the bottom sat under the
  keys. The find bar of a note follows the visible area too: with the keyboard
  up, the scroll to a match moved the visible area down the page, and the bar
  fixed to the top of the page was left above the screen until the keyboard
  closed. The bar is moved in the scroll event itself, not by a React render: a
  render came a frame late, and the bar jumped on every step to a match. The
  editor of a note is placed the same way: the whole screen, its bar on top
  included, takes the visible area, so its toolbar is over the keyboard and no
  text is under it.
- On a phone everything starts on a 16px line: the page text and the first and
  last icon of the bar on top.
- On a phone a dialog stands in the middle of the screen, where the system's
  own alerts stand: at the top it hung from the edge like a page sliding down.
  A desktop keeps mantine's place near the top, where the search, a dialog too,
  belongs. One rule in the theme does it for every `Modal`, the confirms
  included.
- A rename on a phone opens no dialog, as on a desktop: in a folder's list the
  row's name turns into a field, and on an opened page the field takes the
  place of the title in the bar on top, the way back and the actions gone from
  the bar until it is done, and the sync control kept after it. New opens two
  tiles over the bar, New folder at the left and New note at the right, under
  the right thumb: from edge to edge with 8px to spare, 88px high, on the
  ground and blur of a menu, an icon over its label. A light scrim covers the
  page and the bar: a tap on it, a tab included, only closes the tiles, and so
  does Escape, and the page under it does not scroll. The focus goes to New
  folder when they open and back to New when they close, apart from a tile's
  tap, whose note or folder takes the focus. While they fade out they take no
  tap: a second quick tap on a tile made a second note or folder. Two items fit
  two big tiles better than a card menu, which Profile keeps for its long list.
  New note opens a note's draft, with its faint name in the editor's bar, which
  a tap turns into the name field. New folder opens the list of the folder on
  screen with a row after the last folder, the way a desktop puts it in the
  table: a dialog in the middle of the screen covered the list the folder went
  into. That row, and a row of the list being renamed, is drawn on the gray of
  a desktop's new row, from edge to edge of the screen, with no line above or
  below it: a card with a shadow read as a window over the list. The page of a
  folder has no `⋯` of its own on a phone either, and its actions are in the
  row of the list above. Done on the keyboard saves (`enterkeyhint="done"`), a
  tap outside the field saves, and a ✕ at the end of the field cancels, as a
  phone has no Escape. A rename started from a lifted row sets the card down at
  once and not after its drop: the card's layer covers the screen and took the
  first tap meant for the new field.
- A toast on a phone is the pill an app drops from the top for a word or two:
  dark, centred under the status bar, as wide as its words, with a check or a
  warning sign and no close button, coming down and fading in and gone after
  2.5 seconds, 6 with a button, or at a tap on it or a flick up. Mantine's card
  slid in sideways from the edge and read as a web page. Only the pill takes a
  touch: the containers span the screen, took the taps meant for the bar under
  them, and on iOS kept the hover that pauses a toast, which then never left. A
  press on a button in the pill, the Undo or the folder of a move, is that
  button's and does not dismiss it. A desktop shows the same dark toast with
  10px corners at the bottom in the middle, as Notion does, gone after 4
  seconds or 6 with a button, or at a click on it outside its buttons, and kept
  while the pointer is on it; a click that ends a text selection in it leaves
  it, so an error is still copied from it; mantine's white card with a colored
  bar and a close button stood at the top right, over Edit and the page's menu,
  and looked like a web page of years ago. The button of a toast is lettered in
  its own lighter blue, which the theme names, since the accent is too dark on
  the toast's ground. A long name without spaces breaks inside the word, so it
  never pushes the button out of the toast or off the screen. `Toasts` draws
  both, for the app and for a site.
- On a phone a screen opened slides in from the right and fades in, and one
  gone back to slides in from the left with no fade, as an app moves its
  screens, on an even ease-out of 300ms: the curve before put most of the way
  into the first frames, and the screen seemed to jump into place; a tab is
  switched to with no move, and the way up moves back, its address compared as
  the names it spells, as the way back in the history compares it: compared as
  written, a folder whose address the history wrote in another way came up with
  no move. The way up goes back in the history when the page before is the
  folder above, and pushes the folder only when it is not: a pushed folder left
  the note behind it, and the back of the browser or of Android opened the note
  again. A note an editor is left for slides in from the left too. A screen
  moves once for its entry of the history, and the editor, which is not such a
  screen, marks that one was left: going back to the note's own entry, the note
  came up with no move. The move starts when the page first shows the answer of
  its route, not on the tap: a screen keeps the last answer while the next one
  loads, and a move on the tap slid in the old screen and then swapped it. Only
  the page moves, never the bars, and `main` clips what reaches past its edge.
  A back the browser takes moves nothing outside an app from the home screen:
  Safari draws the page gone back to under its own swipe, and a move of ours
  after it shook the page. The move's start is also held inline, because WebKit
  paints a page just put in once at rest before the move takes it, and the page
  jumped back to where the move starts. `main` clips with `overflow-x: clip`
  and never `hidden`, which makes it a scroll container, and every sticky bar
  inside it stopped sticking.
- A field that finds something, the search, the find bar of a note, the filter
  of the tree and Move to, starts in lower case with no autocorrect and no
  spell check, as a name or a word is looked up as typed; its return key reads
  Search, and Go in Move to.
- The icon of the app on the home screen is the logo on the theme's ground,
  drawn by `web/icons.ts` from `server/assets/logo.svg`. Android gets one more,
  marked maskable, with the logo at half the width: Android cuts an icon to its
  own shape, a circle or a squircle, and an icon not marked so is shrunk onto a
  white plate. Half the width keeps the corners of the logo inside the circle
  Android keeps whole, 80% of the width.
- In an app opened from an iPhone's home screen a finger drags the page off
  from the left edge and goes to the folder above, the way up in the bar on top
  does, as an app's swipe goes where its back button says. Back in the history
  it went to the page before, the Recent tab of a note opened from there, while
  the bar said the folder. On the root there is no way up and no swipe, and the
  root is known from the address too: the bar still shows the folder before
  while the root loads, and a swipe then opened the root once more. A note or a
  folder is known from its address as well: a folder opened from the root
  showed the root's bar while it loaded, and a swipe then did nothing. A short
  or slow drag puts the page back, and so does a second finger or a touch the
  system takes: a drag given up any other way left the page shifted. Only
  there: a tab of Safari has its own swipe back, and both went back once each,
  and Android's back gesture is the system's. A swipe let go goes back one
  frame after its copy starts to move: drawn in the same task, the page gone
  back to held that first frame some 100ms in Chromium on a CPU four times
  slower, and after it the copy moves on its own. The page leaves as a copy of
  itself, laid over the page gone back to, which is drawn under it and slides
  in from the left as the copy slides off, as a phone's own back moves both.
  The page under keeps a 28% share of the copy's way left behind it on every
  frame: it moves on the copy's clock and curve, with the copy's own start
  time, so both end together. Set to the point the copy had reached, it could
  start a frame later and end after the copy. On its own 300ms it fell behind a
  copy that left in 200ms, and a strip of empty screen showed between them, and
  a curve of its own started again changed speed against the copy
  ([ADR 33](../adr/0033-a-swiped-page-leaves-as-a-copy.md)). The page itself is
  hidden until the next one enters, three seconds at most, and so is the copy.
  The copy lies on a sheet as large as the screen, with the page's ground,
  above the page and under the bars: with no ground the page under showed
  through, and a page under that moves is painted above a copy with no layer of
  its own. The sheet also keeps the copy to the screen, so a long note is not
  one tall layer. The copy takes no touch, and the sheet takes every tap while
  it covers the page: a sheet that let taps through opened a row of the page
  under it. A code block, a table, a formula or a diagram scrolled sideways
  keeps its place on the copy. Only these are read for it, as reading every
  part of a long note held up the first frame of the leave. The copy carries no
  test id, and no id but those of its diagrams, which get ids of their own: a
  diagram's styles and arrow heads find its parts by id, and the copy of a
  diagram whose ids were dropped lost its colors and arrows. A folder gone back
  to that is not yet in the answers the app keeps has nothing to show under the
  copy, and the screen is empty from the moment the copy has left until the
  folder comes, but for the spinner of a screen still loading after 400ms. That
  folder then shows in its place with no move of its own: its 300ms slide after
  the copy had gone was a second move apart from the first. The drag's question
  for the folder above often answers it in time, a quick flick less often, and
  a site asks nothing. A folder gone back to from a folder shows that spinner
  too, in the middle of the screen over the list of the folder left, which
  stays hidden: with the spinner only on a screen with no list, the screen
  stayed empty until the folder came, and placed above a long list scrolled
  down, the spinner was off the screen. A tab tapped while the copy leaves goes
  after the way back and stays. A touch at the edge while a page is still
  leaving starts nothing, as on iOS: it canceled the leave before it, whose way
  back then never came, so quick swipes climbed one level for five, and the
  page jumped back to the finger. So does a touch while the list of the folder
  left is still hidden under the folder that loads: the drag moved that hidden
  list and showed it again as the copy. A drag that starts while the next
  screen still slides in from the right stops that move where the page is and
  goes on from there with the finger; the move held the page in its own place,
  away from the finger, and cleared the drag's place when it ended, and a page
  taken to the finger's own shift jumped back a hundred pixels. The speed of
  such a drag is the finger's alone: counted from the page's place, a short
  slow drag read as a flick and went back. A screen that slides in from the
  left, as one gone back to, goes to the finger, since a drag moves a page only
  to the right. A screen that comes in while the finger is down, such as a
  folder whose answer came, has no move of its own and is handed to the drag at
  the finger. A drag under which the history moves to another entry, such as a
  page tapped before it whose code came late, is put back when let go: the way
  back was the new page's, and the swipe left the page just opened. The way up
  is the folder above in the address, and the bar on top names that folder too,
  not the folder of the page before, as the bar still shows the page before
  while the next one loads, and a quick second swipe went to the same folder
  again. The way up goes back in the history when the page before is that
  folder, the address of either compared as the names it spells: the server and
  the app write some characters of a name, such as brackets, differently. As a
  drag starts it asks for the folder above, so a folder not yet visited is
  often there when the page has left; asked only after the leave, it slid in a
  round trip later. The next screen of that folder takes the question as its
  own and asks nothing again, unless the question went to the copy kept offline
  and the app is online again, or a change or a newer drag came since, or the
  drag was given up, or the swipe was let go more than three seconds before: a
  folder that never came, as a tab was tapped while it loaded, left its
  question for a later visit. The answer is not kept for later, so a folder
  never comes back with a name already renamed or deleted, and a refused
  question sends nobody to sign in. The swipe never starts under a dialog, a
  sheet or a menu, nor in the editor, and for a reader who asked for less
  motion it moves nothing on its own. A touch at the edge holds every move
  until its direction is known, since a move let through starts the page's own
  scroll, which shook the page up and down under the drag; one that goes up or
  down is the scroll. The dragged page is a layer of its own, or WebKit paints
  a long note again on every move. Let go, the page goes on at the finger's
  speed, and a finger drawn back toward the edge as it lifts keeps the page.
  The speed counts from where the finger came down, so a flick of one move is a
  flick: from the moves alone it had no speed and was put back. The point where
  it lifts is not counted: it is the last move's point a little later, and it
  slowed every flick down. The swipe follows a touch on the element it started
  on as well as on the document, as a touch whose element left the page, such
  as a screen replaced by a folder that loaded, no longer reaches the document
  ([quirks](../quirks.md#phones-and-touch-screens)): the page stayed at the
  finger and held the diagrams until the next touch. The swipe saves a rename
  field before it goes back, since it blurs nothing, and the field would have
  gone without saving. The field is gone before the server answers, so a save
  that fails after a swipe, or after a tap on a link, shows its error toast and
  the name typed is lost. The back button, Android's back gesture and the swipe
  of a Safari tab change the page without the app's swipe, and a field left
  open then is dropped. A screen still loading shows its spinner only after
  400ms: one that came up the moment the swiped page was gone read as the page
  jerking.
- The run screen of an HTML app is one bar on top and the frame under it to the
  bottom of the screen: no tab bar and no swipe back from the edge, since the
  screen is outside the layout that owns them and a swipe over the frame
  belongs to the app. The bar is fixed to the top, as the topbar of the other
  screens is, and adds the safe areas of the status bar and the sides; in the
  flow of the page Safari blurred it ([quirks](../quirks.md#ios-and-safari)).
  Its buttons are the 44px of a tap ([touch](touch.md)). Back is the way out.
  See [pages](pages.md#an-html-app).
