# Touch

Sizes and feedback on a touch screen, phone or tablet.

- A touch screen has one scale of sizes, set once in the theme: a menu row and
  an icon button 44px, a labelled button and a field 40px, and a choice of a
  few, a segmented control or a chip beside one, 36px. The layouts at the
  bottom of a phone's editor are the one choice drawn at 40px: they fill the
  strip under the thumb alone, with no chip beside them, as the mockup has it
  ([ADR 29](../adr/0029-the-phone-editor-bars.md)). Two more leave the scale:
  Discard and Restore of a draft's row, plain words with no frame, take the
  44px of an icon button ([editor](editor.md)), and the gray field of a rename
  or a draft's name in a phone's top bar is 38px. Mantine's 26px menu rows put
  the theme and the space three to a fingertip, and a choice drawn at the tap
  height stood twice as tall as the chip beside it. On a touch screen an open
  menu or popover has a clear ground under it that takes the tap closing it
  (`TapGuard`): the menu's own outside tap closed it on touchstart, and the
  click went on to the row underneath and opened the file there. The guard
  closes only on a tap that started on it: a long press opens a menu while the
  finger is down, and lifting that finger sent the guard a click. On a touch
  screen a menu grows out of the corner nearest what opened it, the corner
  taken from where it was placed after any flip. A phone shows no keys, neither
  the list of shortcuts nor a key beside a menu row. The text of a field is
  never under 16px on a touch screen, the sign-in form, the editor and the
  hidden field a copy uses included: iOS zooms the page into a smaller field
  when it takes the focus and never zooms back. `TapGuard` is in a portal:
  inside a row, the rows after it painted over the guard and a press on the
  guard pressed the row. A menu of a phone is a sheet, which has its scrim
  under it instead.
- A name field, for a new entry or a rename, saves on a tap outside it, apart
  from the new row of a folder's list, which keeps a typed name
  ([entries](entries.md)). The field hears the tap as a `click` on the page and
  not only as a blur, and not as a `pointerdown`
  ([quirks](../quirks.md#phones-and-touch-screens)). The rename popover of a
  page on a tablet has a `TapGuard` under it, whose tap saves the field and
  opens nothing beneath; after a failed save its next tap closes the field, as
  Escape does, or the guard held the page until the name changed. The name
  field of a new note there has the same guard, whose tap saves the name and
  closes the field, and keeps it after a failed save. The tap whose own save
  fails keeps the field, even when the name is refused at once, before the
  server is asked. The popover shows with no transition, in the render of the
  tap that asked for it, so the field takes the focus inside the tap
  ([quirks](../quirks.md#ios-and-safari)). The ✕ that cancels the field keeps
  the focus in it on its press, or the tap blurred the field and the blur saved
  before the ✕ could cancel, and Tab skips it for the same reason; it shows on
  every touch screen, a tablet without a keyboard having no Escape either.
- A touch screen answers a tap the way an app does. A pressed row or menu item
  darkens, a list row across its row of the group, and a tab, a button of the
  capsule and the way back dim, as the bars of iOS do, and so does a tile of a
  sheet; the press shows 60ms after the finger lands, so a finger that only
  starts a scroll leaves no flash. Every pressed tone keeps that delay, the one
  of Mantine's outlined and subtle buttons and subtle icon buttons and the ✕ of
  a field included; the 1px shift Mantine gives a pressed button shows at once.
  A button in a row, its menu or its Run, takes the press alone, and the row
  under it stays as it is. The faint name of a new note in a phone's editor bar
  is a tap as tall as the bar, across the bar's middle cell, though its line is
  21px. A list row's press is one band under the whole row: drawn as its
  background with a shadow for the gutter, the two ends lit and went out apart
  from the middle. A row shrinks for a long press only once the finger has
  rested 150ms, so a tap moves nothing. A long press on the chrome selects
  nothing and opens no preview of a link, while a note, code and what a reader
  types still select. iOS draws `:active` only under a `touchstart` listener,
  so the document carries an empty one.
