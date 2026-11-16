# 31. The offer of a draft is a row under the topbar

Status: accepted. Where it applies: [editor](../ui/editor.md).

## Context

A draft left in the browser was offered in a yellow Mantine alert, "An unsaved
draft was found", with the time as the browser's full date and seconds, a white
Restore and a gray Discard. On a phone it took about 140px over the text, its
yellow read as a fault, and Restore, the step most people take, looked the
lesser one. The phone's editor had just got a bar with Save as a word in the
accent and an orange dot for unsaved text
([ADR 30](0030-the-phone-editor-bars.md)).

## Decision

- The offer is a flat row right under the topbar, across the screen, on the
  ground of a code block with a line under it, on a phone and a wide screen
  alike.
- It reads the orange dot, Unsaved draft and the time in the history's form:
  Today, Yesterday or the date, with hours and minutes. Discard is a word in
  the secondary color and Restore a word in the accent, in 600.
- A draft written against another version of the file says "file changed" after
  the time, in orange.

## Options turned down

- A dark capsule over the layout tabs, from the mockups of the phone's editor:
  it hid a line of text until a button was pressed, and looked like a toast
  that does not go away.
- A card with a shadow and an icon over the text: about as tall as the alert,
  and a raised box in an editor drawn flat.
- The yellow alert as it was.
