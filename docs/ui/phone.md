# Phone

How the app works on a phone.

- On a phone the main controls sit at the bottom, under the thumb, in one
  floating bar, the capsule. The top of a screen keeps what is read and seldom
  tapped: the way back, the title, the sync status, and Save in the editor
  ([ADR 28](../adr/0028-the-phone-controls-float-at-the-bottom.md)). The way
  back is at the top left of every screen, with the swipe back, and is not
  repeated in the capsule. The capsule is 62px high with round ends, a solid
  fill of the theme's `capsule` with a 1px line and a shadow. Nothing on a
  phone's bars and sheets is translucent or blurred, as iOS draws them with
  Reduce Transparency on: under a blurred bar the text showed through and the
  contrast changed with the page. In an app opened from the home screen the
  capsule sits just over the home indicator, as the tab bar of iOS 26 does: its
  bottom is the bottom safe area less 14px, about 20px on an iPhone with Face
  ID, and never under 8px; kept over the whole safe area it floated high above
  the indicator. In a tab of Safari it stands 8px over the bottom of the page,
  right over Safari's address bar: the safe area there put it about 23px over
  the bar. New and the bar of a note or a file stand on the same line. It stays
  put while the page scrolls, as an app's tab bar does: put away on a scroll
  down, it read as the toolbar of a browser. A page ends 12px above it, so its
  last line scrolls clear of the capsule, and a list that fits the screen does
  not scroll. It is the same pill on every screen and only its buttons and its
  width change. The editor has no capsule and keeps one strip of its own at the
  bottom ([editor](editor.md)), and a site and the run screen have none. Nine
  controls and the crumbs once shared one row on top, and the crumbs got 25px,
  wrapped and fell over the note as a column.
- In a folder's list, the root included, and on Profile the capsule is a tab
  bar of three places, Notes, Search and Profile, each an icon over an 11px
  label, 16px from the sides of the screen. The current tab is a pill of the
  accent's tint, `tabCurrent`, with its icon filled and its icon and label in
  the accent, the label in the 600 weight: the segmented controls of a phone
  draw the picked part as a pill too, and a current tab drawn only in the
  accent did not match them. The icon of Profile is the initial of the person
  signed in, or the user icon when nobody is, with no status dot. A tap on
  Notes on the root, or on Profile on Profile, scrolls the page to the top, as
  a tab of iOS does; elsewhere the tab opens its page with no move, and Search
  opens the search over the page. A note and a file have no tab bar, as they
  are left by the way back, and a tab bar beside the note's actions was five or
  six buttons with labels that did not fit. Recent is not a tab: the search
  screen opens on the same list. `/recent` still opens it, and Search is the
  current tab there.
- New is a round button beside the capsule at the right, 62px, with the
  capsule's fill, line and shadow, 10px from it and 16px from the edge of the
  screen. It shows only with the right to write, and without it the tab bar
  takes the whole width. New is not a tab: a tab bar of Apple's guidelines
  moves between places and does not act. New opens a sheet, "Create in" and the
  folder's name, with two big tiles, New folder at the left and New note at the
  right, under the right thumb: two items fit two big tiles better than a list
  of rows. Both tiles are white, the ground of a group: a tile filled with the
  accent read as one already picked. A tap on the scrim, the ✕ or Escape closes
  it, and the focus goes back to New, apart from a tile's tap, whose note or
  folder takes the focus. While the sheet closes, its tiles take no tap: a
  second quick tap on a tile made a second note or folder. New note opens a
  note's draft, with its faint name in the editor's bar, which a tap turns into
  the name field. New folder opens the list of the folder on screen with a row
  after the last folder, the way a desktop puts it in the table: a dialog in
  the middle of the screen covered the list the folder went into. That row is
  drawn on the gray of a desktop's new row across its row of the group, with no
  separator above or below it: a card with a shadow read as a window over the
  list.
- A list is drawn in the grouped style of iOS: the root, a folder, the recent
  notes and the results of the search, and the folders of Move to. The page is
  the theme's `groupedBg` and the list one card of `groupedCard` with 12px
  corners, 16px from the sides of the screen, with a banner such as a sync
  problem above it at the same sides. A row is 52px tall: 16px, a 24px icon in
  the tertiary text color, 12px, the name in 17px, its tags, and `⋯` at the
  right edge. The rows are split by a 0.5px line of `groupedSeparator` that
  starts at the text, 52px from the card's edge, with none after the last row,
  and a pressed row fills its row of the card with `rowPressed`. A page with
  content, a note, a file or the editor, stays on the plain page ground. On a
  list the bar on top, the page and the color the browser draws its own bars
  in, `theme-color`, all take `groupedBg`, so Safari's bars match, and the
  capsule and New take a fainter line and shadow, `capsuleBorderGrouped` and
  the `capsuleGrouped` shadow: the ones drawn for a white page looked heavy on
  the gray.
- The first screens of the tabs, the root and Profile, start their header on
  one line, the row of the bar on top: the root's logo and space name, and
  Profile's large title, 34px in the 800 weight, with the sync control at the
  right of both. With the title under an empty bar, Profile's header stood
  about 60px lower than the root's, and a tab switch made it jump.
- On a note the capsule is the note's actions, icons only: Outline, Find in
  note, Edit and `⋯`. Each shows only where it can be used: Outline when the
  note has headings, Edit with the right to write. The bar hugs its buttons and
  stands in the middle of the screen: 52px high, each button 52px by 44px with
  no gap between them and 4px of room inside the bar, so 216px wide with four
  buttons and 164px with three. A bar as wide as the tab bar with three or four
  icons spread over it looked too big for what it holds. Its bottom is on the
  line of the tab bar's, and its 1px line is drawn inside it, so it takes no
  room from the buttons. The tab bar of a list keeps its 62px. The note's bar
  on top holds only the way back, the title and the sync status, while a tablet
  and a desktop keep Edit and the menu there: on top they were out of the
  thumb's reach, and Outline and Find in note were deep in the menu. While a
  rename has its field in the bar on top, the note's capsule stays, and the
  keyboard covers it. The page of any other file has Run for an HTML app, Edit
  for a text file with the right to write, and `⋯`; its bar on top has no
  Download and no `⋯`, and Download is the first row of its `⋯`, above Copy
  link.
- Every menu on a phone is a sheet from the bottom in the grouped style of iOS
  ([ADR 28](../adr/0028-the-phone-controls-float-at-the-bottom.md)): a grabber,
  the title with a round ✕, groups of rows with 14px corners on the sheet's
  gray ground, and a destructive row in red in a group of its own. A tap on the
  scrim, the ✕ or Escape closes it, and the focus moves into the sheet and back
  to what opened it. A finger drags a sheet down by any part of it, as the
  grabber says: let go past a quarter of its height or with a flick, it closes,
  and otherwise it settles back. A drag that starts in a list scrolled away
  from its top scrolls the list, a move up or more across than down drags
  nothing, and a second finger puts the sheet back. Move to, the history and
  the outline are dragged the same way. A row closes the sheet first and then
  acts. A menu used to open beside the control that opened it, which hung it
  far from the thumb when the control was in the bar on top; from the capsule's
  buttons a sheet stands right by them. The `⋯` of a row in a list is still far
  from its sheet, and the sheet was kept for one menu style everywhere. The `⋯`
  of a note opens a sheet with the note's title: three tiles, Markdown, HTML
  and PDF, then History, Copy link, Rename and Move to..., then Delete, and at
  the foot the count of words and the time of the last edit. History is there
  only where the space records versions, a reader without the right to write
  sees no Rename, Move to or Delete, and the page width is not on a phone.
  Outline and Find in note are not in it, as they are in the capsule. The `⋯`
  of a file holds Download, Copy link, Rename, Move to... and Delete. A row of
  a list has a sheet of its own ([sidebar](sidebar.md)), and the outline is a
  sheet with the same grabber and round ✕.
- The search and Find in note are light cards over the keyboard, as the capsule
  holds no field: a field in a bar of buttons squeezed both, and the keyboard
  covered the bar. The search fills the screen and covers the tab bar, with the
  recent notes or the results above and the card at the bottom: Fuzzy or Exact
  and Titles only at its top, the hint of the mode under them, and the field
  with Aa, ab, .\* and ✕ last, nearest the thumb, as the options are tapped
  less often than the field. A field at the top of a tall phone is out of the
  thumb's reach. The field has the focus as soon as the search opens, so the
  keyboard comes up with it; the dialog's focus trap is told to keep it there,
  as on its own it moved the focus to Fuzzy, the first control of the card. The
  card stands 8px over the keyboard, or over the home indicator when no
  keyboard is up. The count of matches is a small line over the card, shown
  only once there is a query. The recent notes head the screen, each its title
  over its path, with Clear in their header, which empties the list at once; a
  desktop's search has no Clear. With the reading copy the Search tab stays,
  and the search shows only the recent notes, with the field disabled and the
  line "Search needs the network", so the notes read last are still a tap away.
- Find in note is a card 8px from the bottom and the sides of the screen: the
  field, the count and ✕ in its first row, and Aa, ab and .\* with the steps up
  and down in the second. The note's capsule is hidden while the card is open,
  and the tab bar does not come in its place. The search card and the find card
  are placed by the visible area of the screen, not by CSS alone: a phone's
  keyboard covers the bottom of the page without making it shorter, and a card
  fixed to the bottom sat under the keys. With the keyboard up, the scroll to a
  match moves the visible area down the page, and the find card follows it. It
  is moved in the scroll event itself, not by a React render: a render came a
  frame late, and the card jumped on every step to a match. The editor of a
  note is placed the same way: the whole screen, its bar on top included, takes
  the visible area, so its toolbar is over the keyboard and no text is under
  it.
- Profile is a page of its own at `/profile` on the gray ground of a sheet,
  since it holds the account, the spaces, the theme and the offline copy, a
  place and not a menu
  ([ADR 28](../adr/0028-the-phone-controls-float-at-the-bottom.md)). From the
  top: the large title Profile in the bar, a card with the initial, the name
  and the space, the Sync group, Workspace, Theme, then Offline access,
  Read-only mode where it applies, and Sign out, or Sign in when nobody is
  signed in, each a group of its own 14px apart; with the reading copy there is
  neither, and no Read-only mode. Offline access is one row of 48px, its icon,
  its name and the switch in the middle of the row, and what the copy holds,
  such as "181 MB, updated at 21:29", or why it is off, such as "Needs HTTPS"
  with the switch off and dimmed, is the footer under the group
  ([look](look.md)). Sign out is one red row of 48px. A desktop has no link to
  the page and keeps the space's menu. With nobody signed in the card reads
  "Not signed in" beside the user icon. Workspace lists the spaces with a check
  on the current one and a "read-only" badge on a read-only one, and Theme is
  Auto, Light and Dark as one pill. The list of keys stays on a desktop. The
  page has no way up and no swipe back, as the first screen of a tab of iOS has
  none. The Sync group says what the popover of the sync control says on a
  desktop: one row while all is sent or is being sent, with no time, as
  `/api/me` carries none; with a problem a row with the name of the state and
  its facts as the footer under it, then the files not synced as a group of
  rows that open them, under "Conflicting files" when the clone has diverged,
  and "Replace local copy..." where it is allowed, a red row in a group of its
  own. A space whose bar shows no sync control has no Sync group, and with the
  reading copy the group is one row, Offline. The yellow banner of a problem is
  hidden on this page, as the group says the same. The sync control at the top
  right stays as it was, on Profile too, and a tap on it opens its popover, as
  on a desktop ([pages](pages.md#layout)).
- On a phone everything starts on a 16px line: the page text, the first and
  last icon of the bar on top, the way back and Save of the editor's bar, the
  way back and the last icon of the run screen's bar, and the text and buttons
  of the draft offer.
- On a phone a dialog stands in the middle of the screen, where the system's
  own alerts stand: at the top it hung from the edge like a page sliding down.
  A desktop keeps mantine's place near the top, where the search, a dialog too,
  belongs. One rule in the theme does it for every `Modal`, the confirms
  included.
- A rename on a phone opens no dialog, as on a desktop: in a folder's list the
  row's name turns into a field, and on an opened page the field takes the
  place of the title in the bar on top, the way back gone from the bar until it
  is done, and the sync control kept after it. The page of a folder has no `⋯`
  of its own on a phone either, and its actions are in the row of the list
  above. In the bar on top Done on the keyboard saves (`enterkeyhint="done"`),
  a tap outside the field saves, and a ✕ at the end of the field cancels, as a
  phone has no Escape. Rename in a sheet puts the field in place in the same
  tap, and the sheet does not give the focus back to the button that opened it:
  the field lost the focus, and iOS then showed no keyboard.
- In a list the rename is done in the row, as in the Files app of iOS. The row
  keeps its look: the ground of the group, its corners, its separators and its
  52px, so nothing moves. Its `⋯` is gone while the field is open, and the name
  is a field of 36px with 8px corners on `groupedField` in 17px text, with the
  name picked up to its extension, so typing replaces only the name. A gray
  round ✕ of 17px at the end of the field clears it, as the clear button of iOS
  does. Done on the keyboard saves, and a tap outside the field or Escape
  cancels; the field losing the focus does nothing, so hiding the keyboard
  keeps what was typed. A swipe back saves it. The field turns off
  autocomplete, autocorrect, capitalizing and spell check, and has no name or
  id, as Safari offered to fill it in from the contacts. The field takes the
  focus without scrolling the page. When the keyboard comes up over the row,
  the page scrolls just enough to keep the row 16px above it, and the bottom of
  the page gets the keyboard's height as room, so a row at the end of the list
  scrolls up too instead of Safari moving the whole screen and the bar on top
  under the status bar.
- A toast on a phone is a capsule 8px over the tab bar or the bar of a note, or
  over the edge of the screen where there is none, 48px high and fully round,
  with the fill of the capsule and the fainter line and shadow it has on a
  group, `capsuleBorderGrouped` and the `capsuleGrouped` shadow, on every page,
  so it reads as one more bar of the same family. Over the tab bar it spans the
  row 16px from each side, from the tab bar's left edge to New's right edge.
  Over the bar of a note or a file it stands in the middle, as wide as its
  content with 16px at the sides, never narrower than that bar and never wider
  than the screen less 16px at each side; `Capsule` puts the bar's width in
  `--scrawl-action-bar-width` for it. With a button, Undo or the folder of a
  move, a check or a warning sign and the text sit at the left and the button
  at the right in the accent, in the 600 weight; without one the sign and the
  text stand in the middle. A long text wraps to a second line and is cut with
  an ellipsis after it; there is no close button. It comes up and fades in and
  goes after 2.5 seconds, 6 with a button, or at a tap on it or a flick down.
  At the top it stood far from the thumb and the controls that made it, which
  all live at the bottom. With the keyboard up it stands over the keyboard,
  placed by the visible area the way the editor is, as a toast fixed to the
  bottom of the page sat under the keys. Mantine's card slid in sideways from
  the edge and read as a web page. Only the pill takes a touch: the containers
  span the screen, took the taps meant for the bar under them, and on iOS kept
  the hover that pauses a toast, which then never left. A press on a button in
  the pill, the Undo or the folder of a move, is that button's and does not
  dismiss it. A desktop shows a dark toast with 10px corners at the bottom in
  the middle, as Notion does, gone after 4 seconds or 6 with a button, or at a
  click on it outside its buttons, and kept while the pointer is on it; a click
  that ends a text selection in it leaves it, so an error is still copied from
  it; mantine's white card with a colored bar and a close button stood at the
  top right, over Edit and the page's menu, and looked like a web page of years
  ago. The button of a desktop's toast is lettered in its own lighter blue,
  which the theme names, since the accent is too dark on the toast's ground. A
  long name without spaces breaks inside the word, and on a phone is cut after
  two lines, so it never pushes the button out of the toast or off the screen.
  `Toasts` draws both, for the app and for a site.
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
  it went to the page before, the Recent list of a note opened from there,
  while the bar said the folder. On the root, on Recent and on Profile there is
  no way up and no swipe, and the root is known from the address too: the bar
  still shows the folder before while the root loads, and a swipe then opened
  the root once more. A note or a folder is known from its address as well: a
  folder opened from the root showed the root's bar while it loaded, and a
  swipe then did nothing. A short or slow drag puts the page back, and so does
  a second finger or a touch the system takes: a drag given up any other way
  left the page shifted. Only there: a tab of Safari has its own swipe back,
  and both went back once each, and Android's back gesture is the system's. A
  swipe let go goes back one frame after its copy starts to move: drawn in the
  same task, the page gone back to held that first frame some 100ms in Chromium
  on a CPU four times slower, and after it the copy moves on its own. The page
  leaves as a copy of itself, laid over the page gone back to, which is drawn
  under it and slides in from the left as the copy slides off, as a phone's own
  back moves both. The page under keeps a 28% share of the copy's way left
  behind it on every frame: it moves on the copy's clock and curve, with the
  copy's own start time, so both end together. Set to the point the copy had
  reached, it could start a frame later and end after the copy. On its own
  300ms it fell behind a copy that left in 200ms, and a strip of empty screen
  showed between them, and a curve of its own started again changed speed
  against the copy ([ADR 32](../adr/0032-a-swiped-page-leaves-as-a-copy.md)).
  The page itself is hidden until the next one enters, three seconds at most,
  and so is the copy. The copy lies on a sheet as large as the screen, with the
  page's ground, above the page and under the bars: with no ground the page
  under showed through, and a page under that moves is painted above a copy
  with no layer of its own. The sheet also keeps the copy to the screen, so a
  long note is not one tall layer. The copy takes no touch, and the sheet takes
  every tap while it covers the page: a sheet that let taps through opened a
  row of the page under it. A code block, a table, a formula or a diagram
  scrolled sideways keeps its place on the copy. Only these are read for it, as
  reading every part of a long note held up the first frame of the leave. The
  copy carries no test id, and no id but those of its diagrams, which get ids
  of their own: a diagram's styles and arrow heads find its parts by id, and
  the copy of a diagram whose ids were dropped lost its colors and arrows. A
  folder gone back to that is not yet in the answers the app keeps has nothing
  to show under the copy, and the screen is empty from the moment the copy has
  left until the folder comes, but for the spinner of a screen still loading
  after 400ms. That folder then shows in its place with no move of its own: its
  300ms slide after the copy had gone was a second move apart from the first.
  The drag's question for the folder above often answers it in time, a quick
  flick less often, and a site asks nothing. A folder gone back to from a
  folder shows that spinner too, in the middle of the screen over the list of
  the folder left, which stays hidden: with the spinner only on a screen with
  no list, the screen stayed empty until the folder came, and placed above a
  long list scrolled down, the spinner was off the screen. A tab tapped while
  the copy leaves goes after the way back and stays. A touch at the edge while
  a page is still leaving starts nothing, as on iOS: it canceled the leave
  before it, whose way back then never came, so quick swipes climbed one level
  for five, and the page jumped back to the finger. So does a touch while the
  list of the folder left is still hidden under the folder that loads: the drag
  moved that hidden list and showed it again as the copy. A drag that starts
  while the next screen still slides in from the right stops that move where
  the page is and goes on from there with the finger; the move held the page in
  its own place, away from the finger, and cleared the drag's place when it
  ended, and a page taken to the finger's own shift jumped back a hundred
  pixels. The speed of such a drag is the finger's alone: counted from the
  page's place, a short slow drag read as a flick and went back. How far it
  went is counted from the page's place, as the person sees it: a page let go
  while it still shows mostly off the screen goes on out and does not slide in
  again. A screen that slides in from the left, as one gone back to, goes to
  the finger, since a drag moves a page only to the right. A screen that comes
  in while the finger is down, such as a folder whose answer came, has no move
  of its own and is handed to the drag at the finger. A drag under which the
  history moves to another entry, such as a page tapped before it whose code
  came late, is put back when let go: the way back was the new page's, and the
  swipe left the page just opened. The way up is the folder above in the
  address, and the bar on top names that folder too, not the folder of the page
  before, as the bar still shows the page before while the next one loads, and
  a quick second swipe went to the same folder again. The way up goes back in
  the history when the page before is that folder, the address of either
  compared as the names it spells: the server and the app write some characters
  of a name, such as brackets, differently. As a drag starts it asks for the
  folder above, so a folder not yet visited is often there when the page has
  left; asked only after the leave, it slid in a round trip later. The next
  screen of that folder takes the question as its own and asks nothing again,
  unless the question went to the copy kept offline and the app is online
  again, or a change or a newer drag came since, or the drag was given up, or
  the swipe was let go more than three seconds before: a folder that never
  came, as a tab was tapped while it loaded, left its question for a later
  visit. The answer is not kept for later, so a folder never comes back with a
  name already renamed or deleted, and a refused question sends nobody to sign
  in. The swipe never starts under a dialog, a sheet or a menu, nor in the
  editor, and for a reader who asked for less motion it moves nothing on its
  own. A touch at the edge holds every move until its direction is known, since
  a move let through starts the page's own scroll, which shook the page up and
  down under the drag; one that goes up or down is the scroll. The dragged page
  is a layer of its own, or WebKit paints a long note again on every move. Let
  go, the page goes on at the finger's speed, and a finger drawn back toward
  the edge as it lifts keeps the page. The speed counts from where the finger
  came down, so a flick of one move is a flick: from the moves alone it had no
  speed and was put back. The point where it lifts is not counted: it is the
  last move's point a little later, and it slowed every flick down. The swipe
  follows a touch on the element it started on as well as on the document, as a
  touch whose element left the page, such as a screen replaced by a folder that
  loaded, no longer reaches the document
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
