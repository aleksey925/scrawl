# Sidebar

The tree, its head and its foot.

- The sidebar tree lists every folder, empty ones included, and of the files
  only the markdown. A folder is where a page is created, renamed and deleted,
  so it has to be on the tree before it holds anything. Other files are rows of
  the folder's list and open in the app. A note is named on the tree without
  `.md`, the way Notion names a page.
- The sidebar can be put away and the choice is kept. On a desktop it is a
  240px rail the full height of the screen that stays where it was put: the
  sidebar icon at the left of its head hides it, the menu icon the topbar shows
  then brings it back, and `Cmd+B` does both. A phone has no tree: the Notes
  tab opens the root's list and a folder opens the next list, the way the Files
  app on iOS has it, because deep folders ran off a narrow screen as an
  indented tree. A hidden rail holds nothing: mantine only moves it out of
  sight, and the rows left in it would still answer the tab key.
- The head of the sidebar is two icons and nothing else, as Notion's Mail and
  Calendar have it: the sidebar's own at the left, which hides it, and a new
  entry at the right, the sidebar's one way to make one: New file or New
  folder, in the row that is picked, else in the folder of the page on screen,
  and the menu names that folder. Search and Home are the two rows under it.
  Search shows its key, `⌘K`, at its end where there is a keyboard, and Home is
  always filled with the current row's gray, on the home page or not. The label
  over the tree is the space's name and the root folder: it opens the root's
  list and takes a drop. The foot is the space's button under a line across the
  sidebar, as wide as it: the app's logo, the space's name and a chevron at the
  right edge, and it opens one menu upward: the account, the spaces with a
  check on this one, the theme and the shortcuts, then sign out. A site's foot
  is its title, with a menu of the theme, the page width and the shortcuts.
- A folder's icon opens and closes it. The rows of an open folder are indented
  14px and there is no guide line. Every row, a nested one too, keeps 1px under
  it, so two gray rows next to each other, the current one and a picked one, do
  not run into one block; a gap on the tree's stack spaced only the top-level
  rows. Under the pointer the folder's icon turns into a chevron, the sign of
  what a click on it does. The label opens the folder's page, unfolded, and
  only on that page folds and unfolds it too: folding on the way there took a
  second click to see what the folder holds, and arriving unfolded it again
  anyway. A folder with no notes and no folders in it has no arrow, and a
  folder that holds only pictures or other files counts as one, as the tree
  lists only notes. Its icon sits in the same box, so it lines up with the rows
  beside it, and turns into no chevron under the pointer. A click on the icon
  turns it into an open folder and the next one back into a closed one, and the
  name opens and closes it as it does any folder's, so a click shows it was
  taken; nothing unfolds under it. With no change of the icon a click on an
  empty folder looked lost. To a screen reader that icon is a toggle button,
  Open or Close and pressed while open, with no `aria-expanded`, as there is
  nothing under it to expand. Its `⋯`, its `+` and a drop on it work as on any
  folder. Such a folder unfolds by itself when something lands in it, from the
  tree, the page, a move or another tab, and closes again when its last entry
  leaves. This holds inside a closed folder too: that folder stays shut, and
  the one in it shows its new state once it is shown. The tree compares each
  answer of the server with the one before it, by path; an answer from the
  cache, which may be older, does not count. The folders of the page on screen
  open once, when the page is opened: a refresh of the tree after a write
  leaves them as they are, or the folder of the page would open again the
  moment its last entry left. While a filter is on, the name of any folder, an
  empty one too, only opens its page. A filter shows an empty folder open or
  closed as its clicks left it. A line saying the folder was empty only took a
  row to say what the missing arrow says, so an empty space shows no rows under
  its name either, and a right click there still offers New file and New
  folder. A row's `⋯`, and a folder's `+`, show under the pointer, under the
  keyboard's focus and while the menu is open; a touch screen has no hover, so
  there the `⋯` always shows and the `+` never. The same menu is the row's
  context menu: a right click opens it at the `⋯`, not at the pointer, and on a
  tablet a long press, timed by the row because iOS sends no `contextmenu` for
  one. A right click on the free space of the tree, under the rows, opens a
  menu of New file and New folder, made in the root, as the space under the
  rows stands for it. A site has no menu to offer and leaves the browser's own.
  A phone has no tree, so a row of a folder's list carries the same menu: a `⋯`
  beside the row, which a link cannot hold, and a long press anywhere on it.
  They feel the way iOS has them: the `⋯` leaves the row as it is, and a
  resting finger shrinks the row a little, then lifts a copy of it as a card
  over the dimmed and blurred page, with the menu growing out of the card and
  hanging from the row's right edge, inside the page's gutter, where a right
  thumb reaches it, as iOS's own lists hang it; tied to the card's start it
  stood against the left edge. Closing the menu sets the row back down. A row
  lit gray while its menu was up read as a web page. React hands a press inside
  a menu's portal up to the row it belongs to, so a long press only times a
  press that started inside the row itself. The menu offers Edit only where the
  answer gives an edit address: the server writes one on a listing row the
  editor opens, a text name within the size it loads, so a picture's row offers
  none, and a site's rows never carry one. A folder's list asks for its answer
  again after every write the tree is refreshed for: it kept showing a file
  deleted from the tree beside it.
