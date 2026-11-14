# Phone

How the app works on a phone.

- On a phone the controls sit at the bottom, under the thumb: a bar of tabs
  (Notes, Search, Recent, New, Profile) and a round Edit button above it.
  Profile opens the space's menu, the one the sidebar's foot opens: in the bar
  on top it was on the root alone. Its "Offline access" row is the same as in
  the sidebar's menu, and with no network the tabs keep only Notes, Recent and
  Profile. Both stay put while the page scrolls, as an app's tab bar does: put
  away on a scroll down, they read as the toolbar of a browser. A page ends at
  the bar, a note or a file clear of the Edit button, so a list that fits the
  screen does not scroll. Nine controls and the crumbs once shared one row on
  top, and the crumbs got 25px, wrapped and fell over the note as a column. A
  menu opens beside the control that opened it, the way a phone's own menus do;
  drawn as a sheet from the bottom, every menu sat apart from its button. The
  search and the history take the whole screen and the outline is a sheet, each
  over the bar. The search keeps its field at the bottom, over the keyboard,
  with the results above it: a field at the top of a tall phone is out of the
  thumb's reach. The editor has no bar, and a site has none. The search field
  is placed by the visible area of the screen, not by CSS alone: a phone's
  keyboard covers the bottom of the page without making it shorter, and a field
  fixed to the bottom sat under the keys. The find bar of a note follows the
  visible area too: with the keyboard up, the scroll to a match moved the
  visible area down the page, and the bar fixed to the top of the page was left
  above the screen until the keyboard closed. The bar is moved in the scroll
  event itself, not by a React render: a render came a frame late, and the bar
  jumped on every step to a match.
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
  the bar until it is done, and the sync control kept after it. The New file
  dialog stays, since a new entry has no row yet. Its field takes the focus in
  the render of the tap that opened it, with `autoFocus`, and not from the
  dialog's focus trap, which does it a tick later, so the keyboard comes up
  with it ([quirks](../quirks.md#ios-and-safari)). Done on the keyboard saves
  (`enterkeyhint="done"`), a tap outside the field saves, and a ✕ at the end of
  the field cancels, as a phone has no Escape. A rename started from a lifted
  row sets the card down at once and not after its drop: the card's layer
  covers the screen and took the first tap meant for the new field.
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
- On a phone a screen opened slides in from the right and one gone back to from
  the left, as an app moves its screens; a tab is switched to with no move, and
  the way up moves back. The way up goes back in the history when the page
  before is the folder above, and pushes the folder only when it is not: a
  pushed folder left the note behind it, and the back of the browser or of
  Android opened the note again. The move starts when the page first shows the
  answer of its route, not on the tap: a screen keeps the last answer while the
  next one loads, and a move on the tap slid in the old screen and then swapped
  it. Only the page moves, never the bars, and `main` clips what reaches past
  its edge. A back the browser takes moves nothing outside an app from the home
  screen: Safari draws the page gone back to under its own swipe, and a move of
  ours after it shook the page. The move's start is also held inline, because
  WebKit paints a page just put in once at rest before the move takes it, and
  the page jumped back to where the move starts. `main` clips with
  `overflow-x: clip` and never `hidden`, which makes it a scroll container, and
  every sticky bar inside it stopped sticking.
- In an app opened from an iPhone's home screen a finger drags the page off
  from the left edge and goes to the folder above, the way up in the bar on top
  does, as an app's swipe goes where its back button says. Back in the history
  it went to the page before, the Recent tab of a note opened from there, while
  the bar said the folder. On the root there is no way up and no swipe. A short
  or slow drag puts the page back, and so does a second finger or a touch the
  system takes: a drag given up any other way left the page shifted. Only
  there: a tab of Safari has its own swipe back, and both went back once each,
  and Android's back gesture is the system's. The swiped page stays off the
  edge until the next one enters, and the way back follows only a leave that
  got there, from the entry of the history the drag ended on: a tab tapped
  meanwhile won, and was then taken back, whether its screen had come in or was
  still loading. The swipe never starts under a dialog, a sheet or a menu, nor
  in the editor, and for a reader who asked for less motion it moves nothing on
  its own. A touch at the edge holds every move until its direction is known,
  since a move let through starts the page's own scroll, which shook the page
  up and down under the drag; one that goes up or down is the scroll. The
  dragged page is a layer of its own, or WebKit paints a long note again on
  every move. Let go, the page goes on at the finger's speed, and a finger
  drawn back toward the edge as it lifts keeps the page. The swipe saves a
  rename field before it goes back, since it blurs nothing, and the field would
  have gone without saving. The field is gone before the server answers, so a
  save that fails after a swipe, or after a tap on a link, shows its error
  toast and the name typed is lost. The back button, Android's back gesture and
  the swipe of a Safari tab change the page without the app's swipe, and a
  field left open then is dropped. A screen still loading shows its spinner
  only after 400ms: one that came up the moment the swiped page was gone read
  as the page jerking.
