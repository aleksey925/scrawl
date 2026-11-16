# 29. The current tab of the phone's bar is the accent

Status: accepted. Where it applies: [phone](../ui/phone.md),
[look](../ui/look.md).

## Context

The current tab of the phone's bar was only darker than the others: the text
color against the tertiary gray, with the same outline icon. On a white page
the dark tab looked heavy and still did not stand out, and the place a person
was in was hard to see at a glance.

## Decision

- The current tab is drawn in the accent of the theme, its icon in Phosphor's
  fill weight and its label in the 600 weight. The other tabs keep the tertiary
  gray, the regular icon and the 400 weight.
- Nothing is drawn around it: no ground, line, pill or underline, the way the
  tab bar of iOS 7 to 18 shows it.
- Only a place is ever current: Notes, Search and Recent. New and Profile open
  something and are never current, as the tab bar of Apple's guidelines is for
  moving between places, not for actions. The middle cell, Edit or New, stays
  in the gray of the tabs.

This replaces "the current tab dark" of
[ADR 28](0028-edit-in-the-bar-new-as-tiles.md); the rest of ADR 28 stands.

## Options turned down

- The current tab dark, as before: heavy on white, and no accent.
- A pill or a ground behind the current tab, the Liquid Glass look of iOS 26:
  one more shape in a bar that only has to say where the person is.
- An underline: the mark of a web page's tabs, not of a phone's bar.
