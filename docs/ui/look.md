# Look

Colors, controls and type: how a note and the chrome are drawn.

- A note reads the way Notion shows a page. The dark theme file holds Notion's
  dark palette, read off notion.so in October 2026, and the light one the
  colors of macOS: its system blue, cool grays, Xcode's code colors and its own
  text and separator grays. Each color sits under the role it plays; a palette
  key is the property's name, so a note and the chrome cannot drift apart.
  `markdown.css` styles the markup `render` emits with Notion's type scale and
  block spacing: the leading `h1` is the page title, an alert is a callout and
  `<details>` a toggle, all by CSS, so the markup stays what it is. The syntax
  is GitHub's. The note sits in no mantine `Typography`, whose prose rules
  would mix a second look in. A table runs the width of the note: the reader
  puts it in a box that scrolls sideways, because a table that scrolls by
  itself is only as wide as its text.
- The page is white and the sidebar a flush gray panel with a thin line on its
  edge, warm in the dark theme and cool in the light one, where the sidebar's
  icons are the accent and its text black, and the current row is gray with its
  name in the regular weight, as Finder draws them; a bold name beside the gray
  was one mark too many. Borders are only on tables, menus and dialogs, and a
  row is filled only under the pointer or when it is the current one: a list of
  entries, results or versions is rows split by hairlines. A row of the sidebar
  under the pointer takes the current row's gray, and the current row under it,
  Home included, lays that gray twice, as Notion does; a lighter hover read as
  another color and faded the current row a reader pointed at. A picked row
  keeps its tint. A control has one shape, and the theme is the one place that
  says so. A control is Notion's: 28px (36px when it runs the width of its
  column) with 6px corners and a 500 weight, transparent until hovered; a field
  is filled with the hover tint and a faint line, also when the browser filled
  it in, whose own yellow read as a warning, and in focus lifts the way the
  find bar of a note sits: the ground of a popover and the medium shadow of the
  theme, with no ring, in both themes. A blue ring on the gray sidebar read as
  a field of another app, and the light theme ringed in blue what the dark one
  drew as a lighter line, one state drawn two ways. A row a name is typed into
  lifts the same way in the tree, over the sidebar's gray. In a folder's table
  and in a phone's list it does not: the field is plain text and the whole row
  takes the hover tint, as a lifted field with its shadow stuck out of the row
  and broke the rhythm of the lines, and a ring glared across the page. The
  tint is the hover's and not the picked row's gray, which read as a picked
  row. A phone draws that row across its row of the list's group
  ([phone](phone.md)). The keyboard's focus on a grid of the editor lifts the
  same way too. The accent is spent the way Notion spends it, read off its own
  pages: the one main button and a toggle that is on, and on a phone the
  current tab of the bar
  ([ADR 28](../adr/0028-the-phone-controls-float-at-the-bottom.md)); the search
  field has no ring, the back link and Cancel are plain text, and a main button
  that cannot be pressed yet fades in its color. The focus of the keyboard is
  one ring on the chrome, 2px of the accent 2px off the edge, as Mantine draws
  it: a plain button or link of the chrome takes it from one rule in
  `global.css`, where the browser drew a ring of its own that differed from
  control to control. A crumb of the topbar draws it 2px inside its edge, as
  the row of crumbs clips what is outside it, and so does a tab or a button of
  a phone's capsule, which fills the capsule but for its 4px of padding, and so
  do the way back and the Save of a phone's bars, which have 2px of the bar
  above them. The note's own controls in `markdown.css` and the mini outline
  draw theirs to fit their box. The Save of a phone's editor is the exception:
  a word and not a filled button, it is the faint gray of a disabled tab while
  there is nothing to save, so the accent appears only with a change
  ([ADR 29](../adr/0029-the-phone-editor-bars.md)). The light theme spends it
  the way macOS does on two more things: a link in a note, which the dark theme
  draws in the text's color, and the menu row under the pointer, filled with
  the accent and lettered white, which in the dark is the hover tint. A tap
  latches the hover, so a touch screen keeps the tint in both. A menu has 10px
  corners and the theme's shadow, a dialog 12px; a translucent menu ground
  blurs what is under it, as a menu of macOS does. A phone's capsule and sheets
  are solid and blur nothing, as iOS draws them with Reduce Transparency on
  ([ADR 28](../adr/0028-the-phone-controls-float-at-the-bottom.md)). Icons are
  Phosphor's regular weight at 20px, 16px in menus. The other sizes are named
  in `layout` of `web/src/theme.ts`, each for its own place: 22px in the
  capsule of a phone, in the rows of a sheet and in the 44px tools over a
  phone's keyboard ([ADR 29](../adr/0029-the-phone-editor-bars.md)), 26px on
  New and on the big tiles of its sheet, 18px in the desktop's formatting
  toolbar, 15px in the heads of a folder's list and 14px in small marks such as
  the sync badge; an empty state draws 32px. The current tab of a phone's tab
  bar draws its icon filled, on a pill of the accent's tint, `tabCurrent`
  ([ADR 28](../adr/0028-the-phone-controls-float-at-the-bottom.md)).
  `web/src/icons.ts` is the one place that says which drawing each one is:
  Notion's own set cannot be taken, and Phosphor is the open one closest to it.
  A build keeps only the weights the app draws
  ([frontend](../design/frontend.md#build-and-release)). The note's own
  controls are the one exception: the picture viewer in
  `web/src/reader/viewer.ts` and the buttons and marks of `markdown.css` are
  plain DOM and CSS, and run on a page of the command line too, which carries
  no React, so they write their few drawings themselves; `icons.ts` would bring
  React and the icon set into that page. The compose icon in the sidebar's head
  is drawn in `icons.ts` in Phosphor's line, a rounded square with a slim
  pencil as Notion's and Apple's apps draw it, because Phosphor's has sharp
  corners. A choice of a few is a tray of the hover tint with the picked one
  raised on the popover ground, which slides to a new pick in 200ms. In the app
  it is always `Segmented`, the theme's included: its indicator keeps its own
  transition while mantine turns them all off for a new theme
  ([quirks](../quirks.md#react-mantine-and-the-editor)). The theme buttons of a
  page of the command line slide the same way. On a phone every segmented
  control and the chip of the search are fully round: the picked part is a
  raised pill of the page's ground on a tinted track, `borderLight`, with its
  label in the 600 weight, so a phone speaks one pill shape with the current
  tab ([ADR 28](../adr/0028-the-phone-controls-float-at-the-bottom.md)). A
  desktop keeps the 6px corners. A screen on the ground of a sheet sets
  `--scrawl-segment-track` to `sheetClose`, as the track of `borderLight` did
  not show on a group in the dark theme.
- A sheet of a phone, `Sheet` in `web/src/components/Sheet.tsx`, is the grouped
  sheet of iOS on mantine's `Drawer` from the bottom: 14px top corners on the
  theme's `groupedBg` ground, a 36px grabber, a title of 17px in the 600 weight
  with a round ✕ of 32px on `sheetClose`, and groups of `groupedCard` with 14px
  corners. A row is 50px tall with a 22px icon and 17px text, and the rows of a
  group are split by `borderTranslucent`: in the dark theme `borderLight` is
  the color of a group itself. A destructive row is red in a group of its own.
  A row of a group is one line: its icon at the left and its control at the
  right, a switch, a check, a time or a chevron, sit in the middle of the row's
  height, never on its first line of text, and a longer explanation is a footer
  under the group, 13px in the secondary text color with 6px over it and 16px
  at the sides, as in the Settings of iOS. A tile is 72px tall and a big one
  104px, on the ground of a group. The note at the foot is 13px in the tertiary
  text color. The capsule's colors are `capsule` for the fill, `capsuleBorder`
  for its 1px line and the `capsule` shadow: white with a faint line in the
  light theme, the popover's gray with the dark border in the dark one.
- A status the topbar shows with no facts behind it, a calm sync state or the
  offline mark, opens a small dark tip under its button rather than a popover:
  `StatusTip`, Notion's tooltip: 6px by 10px of padding, the medium radius and
  shadow, the state's word in the tip's text color and a second line, when
  there is one, in its gray. Its colors are the theme's `tooltip`,
  `tooltipText` and `tooltipTextSecondary`, dark in both themes, as Notion and
  macOS draw a tooltip dark on a light page too.
- A dialog ends in one row of buttons, `DialogActions`, which the confirms take
  as their `groupProps`: on a desktop at the right, as wide as their words and
  32px tall, as the prototype has them, and on a phone sharing the row in equal
  parts as an alert of iOS does, at the touch height every labelled button has.
  Three buttons on a phone stand one under another across the dialog, as iOS
  stacks them, so a long label is never cut short in a third of the row. No
  dialog sets a height of its own: the editor's gave its buttons the 44px of an
  icon button on every screen, and they stood taller than the buttons of every
  other dialog. A dialog or a drawer with a title keeps 4px between the title
  and what comes first under it, the room of a focus ring outside a button, so
  the ring of a button right under the title shows whole. The 4px are taken
  from the bottom padding and the least height of the title, so the title and
  the room together are as tall as a Mantine title alone, with a close button
  or without. The Outline sheet sets the padding of its title itself, so it
  leaves the bottom one at 0. One with no title gets no room, as nothing is
  drawn over it ([quirks](../quirks.md#react-mantine-and-the-editor)).
- The dark scheme is Notion's dark: a `#191919` page, a `#202020` sidebar and
  `#f0efed` text. Bold there is 700 instead of 600. Near-white letters on a
  near-black page glow and look heavy already, so bold, italic and headings in
  a note read as plain text. Weight alone did not fix it, so a note's text
  there is `textBody`, a clear step below `text`, and emphasis, headings and
  the page title are `textEmphasis`, a step above. In the light theme all three
  are `text`.
- A `<mark>` is the yellow block ground under the note's own text, in both
  schemes, the way Notion highlights; each scheme's yellow ground is opaque,
  because a translucent yellow laid over the dark page came out brown.
