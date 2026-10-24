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
  impossible. The slug turns Cyrillic into Latin with the same table
  `store/upload.go` uses for attachment names, letter for letter, and no test
  holds the two together: a page and the pictures beside it must not spell one
  word two ways.
- A folder with things in it is deleted only on a second word. The API refuses
  it without `recursive=true`, so an agent that named the wrong path does not
  lose a tree to one request, and the page asks "and everything in it?" in the
  one dialog instead of failing after the reader had confirmed. The removal
  takes the files the store hides too: a folder that kept its `.DS_Store`
  looked empty and never went. That case is not listed, so the refusal of a
  plain delete is what raises the question.
