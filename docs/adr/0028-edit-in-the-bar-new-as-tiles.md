# 28. Edit is in the phone's bar, and New opens tiles

Status: accepted, apart from the current tab drawn dark, replaced by
[ADR 29](0029-the-current-tab-is-the-accent.md). Where it applies:
[phone](../ui/phone.md).

## Context

On a phone the bar had five tabs, Notes, Search, Recent, New and Profile, and a
note had a blue round Edit button above the bar. The button covered the text
under it, and the page kept room at its end so the last line could scroll out
from under it. New opened a card menu of two items, New note and New folder.

## Decision

- The bar is Notes, Search, the action, Recent, Profile. The action is one cell
  as wide as a tab and holds one thing:
  - Edit, a link to the editor, on a note or a text file;
  - a disabled Edit on any other file, so the cell does not jump from a note to
    a picture;
  - New in a list and on every other screen;
  - nothing when the person cannot write, and the four tabs share the width.
- The cell is drawn in the gray of the tabs, so the dark current tab stays the
  one dark cell. A disabled Edit is faint.
- A note has no New: Edit takes the cell, and a note is made from a list.
- The blue round Edit button goes away on a phone. A desktop keeps its Edit in
  the topbar.
- New opens two tiles over the bar, New folder at the left and New note at the
  right, under the right thumb, with a light scrim over the page. A tap on the
  scrim only closes, as Escape does.
- Profile keeps its card menu: two tiles fit two items, a card fits a long
  menu.
- The bar stays as it was: solid, a 1px line on top, the current tab dark, in
  place on a scroll.

## Options turned down

- A floating capsule of tabs with a round button beside it: it reads as a layer
  over the page and takes more room than a flat bar.
- The action at the right, apart from the tabs behind a line: the thumb reaches
  the middle of the bar more easily, and the line looked like a fifth tab cut
  off.
- The action before Profile: two buttons that open something stood side by
  side, and a tap meant for one hit the other.
- A card menu for New, as before: two short items left a small card far from
  the thumb.
- A card with an arrow to the button: the arrow added nothing a phone's own
  menus draw.
- The bar swapped for a toolbar of New folder, New note and Cancel: the tabs
  vanished under the finger and the screen changed more than the action needed.
