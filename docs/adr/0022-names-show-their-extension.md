# 22. Names show their extension, and a rename happens in place

Status: accepted. Where it applies: [entries](../ui/entries.md),
[sidebar](../ui/sidebar.md), [pages](../ui/pages.md).

## Context

The app hid `.md`: the tree, the path in the topbar, the toasts and Move to
showed `guide`, while the folder's list showed `guide.md`. To make the hidden
extension work, a rename had to guess: a bare name got `.md` back, and a name
like `guide.en` was read as a name with its own extension `en`. The guess was
wrong for real names (`guide.en.md`, `v1.2.md`), it needed special code for a
field left as it was, and a person never saw the real file name they were
editing. A rename also worked in two ways: in the tree the row's name turned
into a field, everywhere else a modal dialog covered the page and the row.

## Decision

- No blocking rename dialog anywhere. The name turns into a field where it is
  shown: the tree row, the name cell of a folder's list, a popover under the
  last crumb of an opened page on a desktop, and the title's place in the bar
  on top on a phone.
- The same keys everywhere: Enter, or Done on a phone's keyboard, saves, a
  click or a tap outside saves, Escape cancels on a desktop, and a ✕ inside the
  field cancels on a touch screen.
- Extensions are never hidden: every place shows a note as `guide.md`, with no
  other color for the extension.
- The field shows the whole name. Nothing is selected, and the cursor stands
  before the last dot, or at the end of a name without one.
- A rename does not guess: the new name is what was typed, only the spaces
  around it trimmed. A create still starts from a title and goes through the
  slug.

## Options turned down

- Keep hiding `.md`, as Notion does: the guess broke real names, and the list
  already showed `.md`.
- Draw the extension gray: noise for one thing in every row.
- Select the name before the extension on focus, as Finder and VS Code do: the
  person editing names chose no selection.
- Keep a dialog for a page's menu: it covers the page.
- Rename a page's file in the tree: the tree can be hidden, and it takes the
  eye away from the page.
- Rename by editing the page's `h1`: the title is content, not the file name.
