# Touch

Sizes and feedback on a touch screen, phone or tablet.

- A touch screen has one scale of sizes, set once in the theme: a menu row and
  an icon button 44px, a labelled button and a field 40px, and a choice of a
  few, a segmented control or a chip beside one, 36px. Mantine's 26px menu rows
  put the theme and the space three to a fingertip, and a choice drawn at the
  tap height stood twice as tall as the chip beside it. On a touch screen an
  open menu or popover has a clear ground under it that takes the tap closing
  it (`TapGuard`): the menu's own outside tap closed it on touchstart, and the
  click went on to the row underneath and opened the file there. The guard
  closes only on a tap that started on it: a long press opens a menu while the
  finger is down, and lifting that finger sent the guard a click. On a touch
  screen a menu grows out of the corner nearest what opened it, the corner
  taken from where it was placed after any flip. A phone shows no keys, neither
  the list of shortcuts nor a key beside a menu row. The text of a field is
  never under 16px on a touch screen, the sign-in form, the editor and the
  hidden field a copy uses included: iOS zooms the page into a smaller field
  when it takes the focus and never zooms back. `TapGuard` is in a portal, and
  the mark a lifted row's menu opens from sits beside the scaled card and not
  in it: inside a row, the rows after it painted over the guard and a press on
  the guard pressed the row, and inside a scaled element a fixed one is placed
  in that element, which shrank the guard to the card.
- A touch screen answers a tap the way an app does. A pressed row or menu item
  darkens, a list row from edge to edge of the screen, and a tab, the way back
  and the round Edit button dim, as the bars of iOS do; the press shows 60ms
  after the finger lands, so a finger that only starts a scroll leaves no
  flash. A list row's press is one band under the whole row: drawn as its
  background with a shadow for the gutter, the two ends lit and went out apart
  from the middle. A row shrinks for a long press only once the finger has
  rested 150ms, so a tap moves nothing. A long press on the chrome selects
  nothing and opens no preview of a link, while a note, code and what a reader
  types still select. iOS draws `:active` only under a `touchstart` listener,
  so the document carries an empty one.
