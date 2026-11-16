# 30. The phone's editor: back, name and Save on top, one strip at the bottom

Status: accepted. Where it applies: [editor](../ui/editor.md),
[phone](../ui/phone.md).

## Context

On a phone the editor's bar was Cancel, the sync control and a big blue Save.
The tabs Text, Preview and Changes stood in a row of their own under it, and
the formatting toolbar under them, with small pale icons. The state of the save
was hidden. Three rows on top took the height of the text, the tabs were far
from the thumb, and the toolbar was away from the keyboard the person typed on.

## Decision

- The bar on top is the way back, the file's name with the state of the save
  under it, and Save. Back does what Cancel did. Save is a word in the accent,
  always there: gray and disabled with nothing to save, the accent with a
  change, so the bar does not jump. It still saves and opens the reader.
- The sync control is not in the phone's editor. It tells about the whole
  space; a problem there is the banner, and Save leads to the reader, which has
  the control. The offline mark is not there either: the 64px cells beside the
  name have no room for it without moving the name off the middle, the draft
  keeps the text on the device, and a save with no network shows its toast.
- The phone's editor is the one below the phone width, the width the phone's
  bar on top and its tab bar start at. Between that and a wide screen the
  editor keeps the desktop's bar and toolbar, and its layouts leave out Split,
  which needs a wide screen.
- The state of unsaved changes is Draft on device once the browser's storage
  holds the draft, and Unsaved changes before that or when the storage refused
  it. The desktop reads the same words.
- The bottom of the screen is one strip. With no focus in the text it is the
  layouts as a choice of three, with a dot on Changes while there is something
  unsaved. With the focus in the text it is the formatting toolbar over the
  keyboard, 44px tools in the text's color, and a button that puts the keyboard
  away. The strip switches on the focus, not on a guess of the keyboard's
  height, and the toolbar follows the bottom of the visible area.

## Options turned down

- The tabs on top in a row of their own: they took height and were far from the
  thumb.
- The tabs at the bottom while typing too: two strips over the keyboard ate the
  text.
- Save and Cancel in the bottom strip beside the tabs: the tabs shrank to about
  200px.
- A dark panel "Unsaved changes" with Discard and Save over the tabs: it
  covered the text while reading.
- A Save that comes into the bottom strip only with a change: the bar jumped,
  and a save is made once a session.
- Only the draft kept by itself, with no Save: a save is a step a person takes,
  the draft only keeps the text between saves.
- The sync control in the editor only when there is a problem: the banner
  already shows it.
- "Draft saved" or "Draft autosaved": both read as saved to the server.
- A count of changes on Changes, as the mockup drew it: the count needs a diff
  in the browser or a call to the server on every pause, and the dot says what
  matters, that something is not saved.
