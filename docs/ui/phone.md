# Phone

How the app works on a phone.

- On a phone the controls sit at the bottom, under the thumb: a bar of tabs
  (Notes, Search, Recent, New, Profile) and a round Edit button above it.
  Profile opens the space's menu, the one the sidebar's foot opens: in the bar
  on top it was on the root alone. Both stay put while the page scrolls, as an
  app's tab bar does: put away on a scroll down, they read as the toolbar of a
  browser. A page ends at the bar, a note or a file clear of the Edit button,
  so a list that fits the screen does not scroll. Nine controls and the crumbs
  once shared one row on top, and the crumbs got 25px, wrapped and fell over
  the note as a column. A menu opens beside the control that opened it, the way
  a phone's own menus do; drawn as a sheet from the bottom, every menu sat
  apart from its button. The search and the history take the whole screen and
  the outline is a sheet, each over the bar. The search keeps its field at the
  bottom, over the keyboard, with the results above it: a field at the top of a
  tall phone is out of the thumb's reach. The editor has no bar, and a site has
  none. The search field is placed by the visible area of the screen, not by
  CSS alone: a phone's keyboard covers the bottom of the page without making it
  shorter, and a field fixed to the bottom sat under the keys.
- On a phone everything starts on a 16px line: the page text and the first and
  last icon of the bar on top.
- On a phone a dialog stands in the middle of the screen, where the system's
  own alerts stand: at the top it hung from the edge like a page sliding down.
  A desktop keeps mantine's place near the top, where the search, a dialog too,
  belongs. One rule in the theme does it for every `Modal`, the confirms
  included.
- A toast on a phone is the pill an app drops from the top for a word or two:
  dark, centred under the status bar, as wide as its words, with a check or a
  warning sign and no close button, coming down and fading in and gone after
  2.5 seconds, or at a tap on it or a flick up. Mantine's card slid in sideways
  from the edge and read as a web page. Only the pill takes a touch: the
  containers span the screen, took the taps meant for the bar under them, and
  on iOS kept the hover that pauses a toast, which then never left. A desktop
  keeps the card at the top right. `Toasts` draws both, for the app and for a
  site.
- On a phone a screen opened slides in from the right and one gone back to from
  the left, as an app moves its screens; a tab is switched to with no move, and
  the way up moves back although it pushes an address. The move starts when the
  page first shows the answer of its route, not on the tap: a screen keeps the
  last answer while the next one loads, and a move on the tap slid in the old
  screen and then swapped it. Only the page moves, never the bars, and `main`
  clips what reaches past its edge. A back the browser takes moves nothing
  outside an app from the home screen: Safari draws the page gone back to under
  its own swipe, and a move of ours after it shook the page. The move's start
  is also held inline, because WebKit paints a page just put in once at rest
  before the move takes it, and the page jumped back to where the move starts.
  `main` clips with `overflow-x: clip` and never `hidden`, which makes it a
  scroll container, and every sticky bar inside it stopped sticking.
- In an app opened from an iPhone's home screen a finger drags the page off
  from the left edge and goes back: in the history when the app has one, else
  to the folder above, as the way up does. A short or slow drag puts the page
  back, and so does a second finger or a touch the system takes: a drag given
  up any other way left the page shifted. Only there: a tab of Safari has its
  own swipe back, and both went back once each, and Android's back gesture is
  the system's. The swiped page stays off the edge until the next one enters,
  and the way back follows only a leave that got there, from the entry of the
  history the drag ended on: a tab tapped meanwhile won, and was then taken
  back, whether its screen had come in or was still loading. The swipe never
  starts under a dialog, a sheet or a menu, nor in the editor, and for a reader
  who asked for less motion it moves nothing on its own. A touch at the edge
  holds every move until its direction is known, since a move let through
  starts the page's own scroll, which shook the page up and down under the
  drag; one that goes up or down is the scroll. The dragged page is a layer of
  its own, or WebKit paints a long note again on every move. Let go, the page
  goes on at the finger's speed, and a finger drawn back toward the edge as it
  lifts keeps the page. A screen still loading shows its spinner only after
  400ms: one that came up the moment the swiped page was gone read as the page
  jerking.
