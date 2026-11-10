# 20. Delete goes to a trash for 5 minutes, with Undo and no dialog

Status: accepted. Where it applies: [storage](../design/storage.md#the-trash),
[entries](../ui/entries.md).

## Context

Until this decision scrawl asked in a dialog before every delete, and asked a
second time for a folder that was not empty. Notion asks nothing: it deletes at
once and shows a toast with Undo. scrawl now works the same way, but the server
erased a file at once, so an Undo had nothing to bring back.

## Decision

- `store.Trash` moves the entry into `.scrawl-trash/<id>/` at the root of the
  space, `store.Restore` moves it back, and the delete endpoint answers with
  the `trash_id` that `POST /api/trash/restore` takes.
- An entry is kept for 5 minutes, then swept. Undo is the only way back, and it
  shows for 6 seconds.
- The page deletes with no dialog, as Notion does. In a git space the delete is
  a commit and pushed as before, and Undo is a second commit that adds the
  files back.

## Options turned down

- A copy in the browser, read before the delete and written back on Undo: only
  while the tab is open, and a folder would need every file in it read first,
  the hidden ones lost.
- The delete sent a few seconds later unless Undo was pressed: another device
  and the API would see the file during those seconds, and a tab closed in them
  would have to send the delete on its way out.
- The trash beside the notes, in a directory of its own: a rename cannot cross
  two `os.Root`s or two filesystems, so every delete would be a copy.
- A trash kept for 30 days with a screen of its own, as Notion has: nobody
  asked for the screen, and without it a longer keep only holds deleted files
  on disk that nobody can reach.
- Restoring from git history: a space without history has none, and git does
  not hold the ignored files a deleted folder had.
