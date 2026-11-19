# 28. The phone's controls float at the bottom, and its menus are sheets

Status: proposed. Where it applies: [phone](../ui/phone.md),
[editor](../ui/editor.md), [look](../ui/look.md).

## Context

On a phone the bar at the bottom was five cells: Notes, Search, the action,
Recent and Profile. The action was Edit on a note and New in a list, so one
cell changed its meaning from screen to screen. A note kept its menu in the bar
on top, out of the thumb's reach, and Outline and Find in note sat deep in that
menu. Profile was a menu, though it holds the account, the spaces, the theme
and the offline copy. Recent was a tab, though the search screen opens on the
same list. Menus opened beside their button, so a menu from the bar on top hung
far from the thumb, and the find bar of a note stood at the top of the screen.

## Decision

- Primary actions live at the bottom, under the thumb. The top of a screen
  keeps what is read and seldom tapped: the way back, the title, the sync
  status, and Save in the editor.
- One floating bar, the capsule, is at the bottom of every screen but the
  editor. It is the same pill everywhere, with its buttons changing by screen:
  - in a list and on Profile it is a tab bar of places, Notes, Search and
    Profile, icons over labels, and a round New button stands apart beside it,
    as a tab bar holds places and not actions;
  - on a note it is the note's actions, icons only: Outline, Find in note, Edit
    and the menu; on any other file Run, Edit and the menu. This bar hugs its
    icons in the middle of the screen, as a bar as wide as the tab bar looked
    too big for three or four icons.
- The capsule holds no field. Search and Find in note are light cards over the
  keyboard, and the capsule is hidden while one is open.
- The current tab is an accent-tint pill with the accent icon and label. The
  segmented controls and chips of a phone are fully rounded, with the picked
  segment a raised fill on a tinted track, so a phone speaks one pill shape.
- Every menu on a phone is a sheet from the bottom in the grouped style of iOS:
  a grabber, a title with a close button, groups of rows, and a destructive row
  in a group of its own. A sheet is dragged down by a finger to close it, as a
  sheet of iOS is, and the grabber is the sign of it. New opens a sheet of two
  big tiles, New folder at the left and New note at the right, under the right
  thumb. A long press on a row opens the same sheet as its `⋯`.
- Recent is no longer a tab: the search screen opens on the recent notes, with
  Clear in their header, and `/recent` stays an address. With no network the
  search tab stays and shows only those notes.
- Profile is a place: a tab with a page of its own at `/profile`, which also
  holds the sync details. The sync control at the top right stays as it was,
  with its popover, on every screen.
- Lists use the grouped style of iOS: a gray page and one white card per list,
  rows split by a line that starts at the text. A note, a file and the editor
  stay on the plain page ground. The root and Profile, the first screens of the
  tabs, start their header on the same line, the row of the bar on top.
- Back is at the top left of every screen, with the swipe back, and is not
  repeated in the capsule.
- Nothing is translucent or blurred: the bars and sheets are drawn solid, as
  iOS draws them with Reduce Transparency on.
- The colors are tokens of the theme files: the sheet ground and its groups,
  the capsule's fill, line and shadow, and the current tab's tint.

## Options turned down

- A flat bar of five cells with Edit or New in the middle cell: the cell
  changed meaning with the screen, and a note's other actions stayed out of
  reach at the top.
- New inside the tab bar: a tab bar of Apple's guidelines moves between places
  and does not act.
- The note's actions in the tab bar beside the tabs: five or six icons with
  labels did not fit, and the tabs are not needed on a note, which is left by
  the way back.
- Search and find inside the capsule: a field in a bar of buttons squeezed
  both, and the keyboard covered the capsule.
- Menus beside their button: drawn from the bottom they now sit next to the
  capsule's buttons. The `⋯` of a row in a list is still far from its sheet,
  and the sheet was kept for one menu style everywhere.
- The sync control as a link to Profile, with no popover: the status at the top
  right is read at a glance on any screen, and its popover keeps the details
  one tap away without leaving the page.
- The current tab drawn only in the accent with nothing around it: it did not
  match the pill of the segmented controls.
- Hiding the capsule on a scroll down: it read as the toolbar of a browser.
- A translucent, blurred capsule, the Liquid Glass look of iOS 26: the text
  under it showed through and the contrast changed with the page.
