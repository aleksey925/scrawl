# Entries

Creating, naming, moving and deleting files and folders.

- A new note is a draft
  ([ADR 26](../adr/0026-a-new-note-is-a-draft-named-by-its-heading.md)). The
  editor opens at once at `/edit/<folder>/untitled.md?draft`, with `# ` and the
  cursor after it, and nothing is on disk until the first Save. A draft left
  with nothing typed leaves nothing and asks nothing; one with text asks, as
  any editor with unsaved text does. Its name follows the first line that is
  not empty, without its `#`, as a lowercase slug: `Weekly plan` is
  `weekly-plan.md`, `План на неделю` is `plan-na-nedelyu.md`, and no text is
  `untitled.md`. The name shows faint in the last crumb, and in the tree as a
  faint row in its folder, since the draft is the page on screen. Save looks at
  the folder and takes `-2`, `-3` for a name already there, writes the file
  with `Created "weekly-plan.md"` and opens it in the reader; `Cmd+S` stays in
  the editor at the new address. Cancel goes back to the screen the draft was
  started on. A click on the faint crumb, or on the faint name in the bar of a
  phone, opens a field with the name: the name typed there stops following the
  heading and keeps its case, and goes by the rules of a typed name below, so
  `todo.txt` turns the draft into that file and the editor into the one of a
  text file, dropping a `# ` that was all the text. A name taken by the time of
  Save is refused with a toast, as a name with a slash or a leading dot is at
  once. The draft is the one way to make a file that is not a note.
- A note is made in the folder on screen, or in the folder the action came
  from: the sidebar's compose icon, `+` on a folder of the tree, `N` where no
  field has the focus outside the editor, the blue New of a folder's page, the
  empty folder's New note, a right click on the free space of the tree, made in
  the root, or of a folder's page, and on a phone the New note tile of the
  bar's New. A folder is made from the arrow beside the blue New, whose menu
  holds New folder alone, the empty folder's New folder, the right click on
  free space and the phone's New folder tile. Its name is typed in a row where
  it will stand: in the tree for the tree's menu, and in a folder's list, on a
  desktop and on a phone, in a row after the last folder, so a long list is not
  scrolled to its end. Enter creates it, and so does a click or a tap outside
  the tree's field, while the row of a list keeps a typed name and drops only
  an empty one, so a click on another row of the list does not make a folder
  with half a name; Escape, or the ✕ on a touch screen, drops either. A row's
  `⋯` creates nothing, and a folder's page has no `⋯` of its own. A dialog
  asked for the folder the tree already knew and then covered it, and one menu
  that named the entry in the tree in one place and in the table in another
  sent the eye away from what the reader was looking at. Rows drag into
  folders, one or the whole picked run; a plain click picks, shift takes the
  range from the row picked last, at first the current one, a file's folder on
  its page, and a modified click stays the browser's "open in a tab". The rows
  being dragged are kept in state as well as in the drag's data, because a page
  cannot read that data during `dragover`, when a folder says whether it takes
  the drop.
- A name typed by hand for a draft is a note unless it carries an extension of
  its own: a title becomes its slug with `.md`, and `notes.txt` or `Main.java`
  is that file, named as typed. A slug, of a note or a folder, keeps the case
  typed, so `My Plan` is `My-Plan.md`: a space usually lives on a file system
  that tells the cases apart, and a name lowercased behind the person's back
  was not the name they typed. The name a draft takes from its heading is
  lowercased, as no name was typed for it. An extension is a dot and a word
  starting with a letter, so the date or the version in a title is not one. A
  name typed with `.md` is a title too, so `My Notes.md` is `My-Notes.md`. A
  rename does not take this rule: it starts from a file name, not a title, and
  the new name is what was typed, only the spaces around it trimmed, so
  `guide.en.md` stays `guide.en.md` and a bare `guide` is a file without an
  extension ([ADR 22](../adr/0022-names-show-their-extension.md)). A note
  renamed without `.md` is not a note any more: it leaves the tree, the page
  follows it to the view of a text file, and the toast says so. A name left as
  it was renames nothing, so a click away from the field of `spaced.md ` does
  not lose its space to the trim. A name that starts with a dot is refused with
  a toast, as a slash is: the store hides such a name, and the server would
  answer only that nothing is found. The slug turns Cyrillic into Latin with
  the same table `store/upload.go` uses for attachment names, letter for
  letter, a capital into a capital (`Ж` is `Zh`), and no test holds the two
  together: a page and the pictures beside it must not spell one word two ways,
  apart from the case, which the name of an attachment drops.
- Rename and Move to are two actions, as in Notion. A rename asks only the name
  and refuses a slash: one field for the whole path made every rename a
  possible move, and a slip in the folder part sent the file away. A rename
  opens no dialog, the name turns into a field where it is shown: a modal
  dialog covered the page and the row being renamed. In the tree and in a
  folder's list the row's name is the field, and a list row takes no click and
  no menu while it holds it, so a click in the field does not open the row. On
  a page, a note, a file or a folder, the field opens in a popover under the
  last crumb of the path, as Notion does, with no backdrop and no buttons; on a
  phone it takes the place of the title in the bar on top. The field holds the
  whole name with its extension, nothing selected and the cursor before the
  last dot, or at the end of a folder's name, where a dot is part of the name.
  Enter, or Done on a phone's keyboard, saves, and so does a click or a tap
  outside the field, but not a switch to another window or app: the field stays
  open with the name typed, and a slip saved a half-typed name, whose links are
  not rewritten ([quirks](../quirks.md#browsers)). Escape drops it, and on a
  touch screen a ✕ inside the field does. A failed save keeps the field with
  the name typed, and a save started with Enter gives the focus back to it,
  unless the focus was put elsewhere while the save was going. Leaving the
  field, by a blur, a tap outside or the swipe back, does not send a name that
  has just failed again: on a touch screen every later tap, the close of the
  error toast too, sent it once more and showed the same error. Enter sends it
  again, and on a tablet a tap beside the popover of a page closes the field
  ([touch](touch.md)). An Enter that ends the composition of an input method
  saves nothing ([quirks](../quirks.md#browsers)). Every rename is a session of
  its own, and a save closes only its own field: a slow save that answers after
  another rename has started leaves the new field open, also when the page
  follows the renamed entry to its new address. Any other page change closes
  the field, so a click on a link saves and goes. Move to opens a popover where
  the menu it was picked from was, on the side of the screen the menu sat on,
  as Notion does; a dialog in the middle of the screen took the eye away from
  the row or the page being moved. On a phone it fills the screen. It holds a
  search field over the folders of the space, the space itself first: empty, it
  shows them as a tree with every folder folded, the one the entry is in too, a
  chevron or the right and left arrows unfold and fold a folder, a click on the
  chevron leaving the focus in the search field for the arrows and Enter, and
  typed, the folders whose name matches, each with the folder it sits in. The
  whole tree open was a long list to scroll through in a real space. The folder
  the entry is in now is marked Current and cannot be picked, a folder being
  moved leaves itself and everything inside it out of the list, and the foot
  shows the path the entry will get, or that the folder already holds that
  name, which is then not moved to. That check knows only the names the tree
  shows: a symlink or a file an exclude glob hides, under the same name, is
  found only by the server, and the toast of the failed move says so. Up and
  down pick, Enter or a click on the row moves, through the same path a drag
  takes, and the page follows an entry that was on screen. The arrows stop on
  the Current folder too, so the right arrow unfolds it to reach the folders
  inside, but Enter there moves nothing.
- The toast of a move, by Move to or a drag, carries Undo for 6 seconds, which
  moves the entries back the same way and takes the page back with them. The
  move is made at once and Undo is a second move, as Notion and Finder do it,
  not held until the toast is gone: the entry is at its new place for a reload,
  another device and the API from the first moment, and a tab closed while the
  toast was up loses nothing. In a git space the history keeps both moves. A
  move that was not pushed or not recorded says so in a warning toast, as any
  other change does, and keeps its Undo. Once a moved entry, or a folder above
  it, is renamed, moved or deleted in the same tab, or something is created at
  its new place, its Undo moves nothing and says the entry changed since: Undo
  knows an entry only by its path, and the one there now may be another. This
  holds from the moment the entry moves, so in a drag of several rows a change
  to one that moved while the rest still move counts too. An Undo already
  running asks again before each entry, so a change made while it waits stops
  it before the rest. A change made in another tab or on disk is found too:
  right after each entry moves the app reads the size and the time of the file
  from the list of its new folder, and before each entry Undo reads them again.
  When they differ, the file there now is another one or was edited since, and
  Undo stops the same way. A folder is checked only for being a folder, because
  its time changes with every change inside it, so another folder put at its
  place outside the tab is not found. When a read fails, Undo goes on without
  this check. Two short gaps stay open, because the server's move takes only
  paths and cannot tell the file is the same one: a file replaced outside the
  tab before its first read, and one replaced between Undo's check and its
  move. Undo is forgotten once its toast closes.
- The toast of a create, a rename, a move, a delete and a copied link names the
  entry by its file name, as every place shows it, and the folder it went to:
  `Moved "guide.md" to "db"`, `Renamed "a.md" to "b.md"`. A bare Moved or
  Deleted did not say what had moved or gone, and an Undo beside it did not say
  what it would undo. The space itself is named by its name. The folder in the
  toast of a move is a link that opens it, drawn as underlined text and not as
  a button, so it does not look like Undo beside it; a slip onto it only opens
  a folder, and the toast stays with its Undo.
- Delete asks nothing: the entry goes at once, a folder with everything in it,
  and the toast carries Undo, which puts it back where it was and takes the
  page back to it if it was open, as Notion does. A dialog before every delete
  was a click more each time, while Undo is there for the one time it is wrong.
  The toast and the move off a deleted page come at once, before the server
  answers, and the row leaves the tree when it does; a delete the server
  refuses says so in a toast of its own. Undo waits for the server: shown done
  and then refused, it would read as two answers to one tap. An Undo that
  fails, of a delete or a move, leaves its toast with its 6 seconds started
  again, so it can be tried once more; the toast goes when Undo works. A move
  Undo tried again moves back only what did not go back the first time. The
  server keeps what was deleted for a few minutes
  ([storage](../design/storage.md#the-trash),
  [ADR 20](../adr/0020-delete-to-a-trash-with-undo.md)). The API still refuses
  a folder that is not empty without `recursive=true`, so an agent that named
  the wrong path does not lose a tree to one request; the page always sends it.
  The removal takes the files the store hides too: a folder that kept its
  `.DS_Store` looked empty and never went.
