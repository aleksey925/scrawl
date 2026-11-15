# 26. A new note is a draft named by its heading

Status: accepted. Where it applies: [entries](../ui/entries.md),
[sidebar](../ui/sidebar.md), [pages](../ui/pages.md), [phone](../ui/phone.md),
[editor](../ui/editor.md), [look](../ui/look.md).

## Context

A note was made by naming a file first. Nine places on a desktop made one, and
they asked for the name in three ways: a field in the tree, a row of the
folder's table and, on a phone, a dialog. The same menu opened the tree's field
in one place and the table's row in another, so the folder's `⋯` named the
entry in the tree while the person looked at the table. New file and New folder
stood side by side and weighed the same, though a note is made every day and a
folder rarely, and the field asked for a file name with a line about extensions
before a word of the note was written.

## Decision

- A new note is a draft. The editor opens at once with `# ` and the cursor
  after it, and nothing is on disk until the first Save, which writes the file
  in one request and one commit. A draft left with nothing typed leaves
  nothing.
- The draft is named by its first line, lowercased: `Weekly plan` is
  `weekly-plan.md`, and no text is `untitled.md`. A taken name gets `-2`, `-3`.
  The name shows faint in the last crumb and in the tree while it follows the
  heading. A click on the crumb sets it by hand; then it keeps the case typed
  and stops following, and a name with an extension of its own, `todo.txt`,
  turns the draft into that file. There is no other way to make a file that is
  not a note.
- One action, New note, and the folder second. A folder's page has a blue New
  that makes a note, with an arrow whose menu holds New folder; the sidebar's
  compose icon, `+` on a folder of the tree and `N` make a note in the folder
  on screen; the phone's New tab offers New note and New folder. A new folder's
  name is typed in a row where folders are: the tree, or the row after the last
  folder of a list.
- The folder's `⋯` in the topbar goes, with its Copy link, Rename, Move to and
  Delete, which stay in the row menu; a row's `⋯` creates nothing; the Files
  pill and the item count go.

## Options turned down

- Create `Untitled.md` at once and rename it in place, as Obsidian and Google
  Drive do: empty `Untitled-2.md` files were left behind, and a git space got
  two commits and two pushes for one note.
- A quick window asking for the title and the folder, as a command palette
  does: one place for the name, but the name still came before the text.
- Keep the name's case from the heading, as a typed title keeps it: the person
  who chose the design wanted file names in one case unless set by hand.
- The menu of New with New note, New folder and New file: New file was a third
  way to make what a draft with an extension already makes.
- A split button whose menu grows out of the button, or an icon beside New: the
  menu of one item, sized to its label, read as the rest of scrawl's menus.
