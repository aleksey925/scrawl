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
  is filled with the hover tint and a faint line, and in focus has the theme's
  focus ring and no halo: in the light theme one solid band of a light blue
  three pixels wide, as macOS rings a field; the field's border takes the
  band's color, or its tint shows through as a gap and the band reads as two
  rings. In the dark one a lighter line and no color, the way Raycast and
  Vercel draw it. A solid blue line on the dark ground glared, and Notion's own
  dark fields disagree with each other on it. A row a name is typed into, in
  the tree or a folder's list, is framed by the same ring. The accent is spent
  the way Notion spends it, read off its own pages: the one main button, a
  focused field in the light theme and a toggle that is on; the search field
  has no ring, the back link and Cancel are plain text, and a main button that
  cannot be pressed yet fades in its color. The light theme spends it the way
  macOS does on two more things: a link in a note, which the dark theme draws
  in the text's color, and the menu row under the pointer, filled with the
  accent and lettered white, which in the dark is the hover tint. A tap latches
  the hover, so a touch screen keeps the tint in both. A menu has 10px corners
  and the theme's shadow, a dialog 12px; a translucent menu ground blurs what
  is under it, as a menu of macOS does. Icons are Phosphor's regular weight at
  20px, 16px in menus, and `web/src/icons.ts` is the one place that says which
  drawing each one is: Notion's own set cannot be taken, and Phosphor is the
  open one closest to it. The new entry in the sidebar's head is drawn there in
  Phosphor's line, a rounded square with a slim pencil as Notion's and Apple's
  apps draw it, because Phosphor's has sharp corners. A choice of a few is a
  tray of the hover tint with the picked one raised on the popover ground.
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
