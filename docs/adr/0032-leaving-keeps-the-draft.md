# 32. Leaving the editor keeps the draft and asks nothing

Status: accepted. Where it applies: [editor](../ui/editor.md).

## Context

Leaving the editor with unsaved changes opened a dialog, "Leave without
saving?", with Leave in red and Stay. Its own text said the changes were kept
as a local draft: the editor writes the text to the browser's storage as it is
typed and offers it back the next time. So the dialog warned about a loss that
did not happen, on every Cancel and every back, and its red button was the
person's own intent. Apple's guidelines keep the destructive style for an
action the person did not choose, and confirm only what cannot be undone; the
apps that keep a draft, Notes and Mail's draft among them, leave at once.

## Decision

- A way out of the editor with unsaved changes writes the draft and leaves with
  no question. A toast says "Changes kept as a draft on this device", with no
  button: the way back is the note, or for a note not created yet the next New
  note in its folder, and the editor offers the draft there.
- When the browser refuses the draft, as a private window or a full storage
  does, or a picture is still uploading, the text would be lost, and only then
  a dialog asks "Discard changes?" with Discard in red and Keep editing, as
  Calendar asks.
- Closing the tab asks the browser's question in those cases alone. The app's
  own check before a reload for a new release still counts any unsaved text as
  a reason to wait, as the reload would lose the place and the undo, until the
  person has left the editor.
- Leaving does not save. A save writes the file, commits and pushes, and stays
  the person's own step.

## Options turned down

- The dialog as it was: a question about a loss that does not happen.
- A save on leaving, as Notes does: a save here is a commit and a push, and an
  explicit Save was a choice made for the phone's editor
  ([ADR 30](0030-the-phone-editor-bars.md)).
- An Edit button in the toast: the way back is known, and a second button in a
  toast that comes on every leave is noise.
- A sheet from the bottom for the discard question: the dialogs of a phone
  stand in the middle, and iOS 26 centres such a question when it is not
  anchored to a button.
