# Entries

Creating, naming, moving and deleting files and folders.

- An entry is made where the action was started: from the sidebar a name field
  appears in the tree, in the folder the action came from, and from a folder's
  list a name row appears in that table. Enter creates it, through the one
  create path both share. A dialog asked for the folder the tree already knew
  and then covered it, and a create started from a list jumped to the tree,
  away from what the reader was looking at. Rows drag into folders, one or the
  whole picked run; a plain click picks, shift takes the range, and a modified
  click stays the browser's "open in a tab". On a phone there is no tree to
  type into: the New tab opens a menu over itself, New file or New folder, and
  the name is asked in a small dialog in the middle, the way a phone asks for a
  new folder's name, with a line saying a name without an extension makes a
  note. A create started from a list asks the same. Every place says New file,
  the tree, the menus and the dialog, since one action makes a note or any
  file; the editor calls a new note a note. The name field ignores a blur for a
  moment after it appears: mantine's menu gives the focus back to its button a
  tick after the field took it, and the field cancelled itself. The rows being
  dragged are kept in state as well as in the drag's data, because a page
  cannot read that data during `dragover`, when a folder says whether it takes
  the drop.
- A name typed for a file is a note unless it carries an extension of its own:
  a title becomes its slug with `.md`, and `notes.txt` or `Main.java` is that
  file, named as typed, case and all, since a slug lowercased the class java
  names the file after. An extension is a dot and a word starting with a
  letter, so the date or the version in a title is not one. A rename takes the
  same rule: a note renamed to a bare title stays a note, and one renamed with
  an extension becomes that file, which the `.md` added to every name had made
  impossible. A name left as it was renames nothing, so a click away from the
  field of `guide.en.md` does not read `en` as an extension and drop the `.md`,
  and one of `guide .md` does not lose its space to the trim of a typed name.
  The slug turns Cyrillic into Latin with the same table `store/upload.go` uses
  for attachment names, letter for letter, and no test holds the two together:
  a page and the pictures beside it must not spell one word two ways.
- Rename and Move to are two actions, as in Notion. A rename asks only the
  name, a note's without `.md`, and refuses a slash: one field for the whole
  path made every rename a possible move, and a slip in the folder part sent
  the file away. From the sidebar the row's name turns into a field in place,
  Enter or a click away keeps it and Escape drops it; from a page's menu, a
  folder's list and a phone it is a small dialog with one field. Move to opens
  a popover where the menu it was picked from was, on the side of the screen
  the menu sat on, as Notion does; a dialog in the middle of the screen took
  the eye away from the row or the page being moved. On a phone it fills the
  screen. It holds a search field over the folders of the space, the space
  itself first: empty, it shows them as a tree with every folder folded, the
  one the entry is in too, a chevron or the right and left arrows unfold and
  fold a folder, a click on the chevron leaving the focus in the search field
  for the arrows and Enter, and typed, the folders whose name matches, each
  with the folder it sits in. The whole tree open was a long list to scroll
  through in a real space. The folder the entry is in now is marked Current and
  cannot be picked, a folder being moved leaves itself and everything inside it
  out of the list, and the foot shows the path the entry will get, or that the
  folder already holds that name, which is then not moved to. That check knows
  only the names the tree shows: a symlink or a file an exclude glob hides,
  under the same name, is found only by the server, and the toast of the failed
  move says so. Up and down pick, Enter or a click on the row moves, through
  the same path a drag takes, and the page follows an entry that was on screen.
  The arrows stop on the Current folder too, so the right arrow unfolds it to
  reach the folders inside, but Enter there moves nothing.
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
  knows an entry only by its path, and the one there now may be another. An
  Undo already running asks again before each entry, so a change made while it
  waits stops it before the rest. A change made in another tab or on disk is
  not seen. Undo is forgotten once its toast closes.
- The toast of a create, a rename, a move, a delete and a copied link names the
  entry, by its title as the tree shows it, and the folder it went to:
  `Moved "guide" to "db"`, `Renamed "a" to "b"`. A bare Moved or Deleted did
  not say what had moved or gone, and an Undo beside it did not say what it
  would undo. The space itself is named by its name. The folder in the toast of
  a move is a link that opens it, drawn as underlined text and not as a button,
  so it does not look like Undo beside it; a slip onto it only opens a folder,
  and the toast stays with its Undo.
- Delete asks nothing: the entry goes at once, a folder with everything in it,
  and the toast carries Undo, which puts it back where it was and takes the
  page back to it if it was open, as Notion does. A dialog before every delete
  was a click more each time, while Undo is there for the one time it is wrong.
  An Undo that fails, of a delete or a move, leaves its toast with its 6
  seconds started again, so it can be tried once more; the toast goes when Undo
  works. A move Undo tried again moves back only what did not go back the first
  time. The server keeps what was deleted for a few minutes
  ([storage](../design/storage.md#the-trash),
  [ADR 20](../adr/0020-delete-to-a-trash-with-undo.md)). The API still refuses
  a folder that is not empty without `recursive=true`, so an agent that named
  the wrong path does not lose a tree to one request; the page always sends it.
  The removal takes the files the store hides too: a folder that kept its
  `.DS_Store` looked empty and never went.
