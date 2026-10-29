# Quirks

Facts about the systems scrawl runs on that no spec says and that were found by
hitting them. A fact a rule in the docs depends on links to that rule, and the
others name the place that works around them. A rule cites a fact in a few
words; the fact itself is written here.

## iOS and Safari

- A long press sends no `contextmenu`, so a row times the press itself.
  [Sidebar](ui/sidebar.md)
- A field whose text is under 16px zooms the page when it takes the focus and
  never zooms back. [Touch](ui/touch.md)
- `:active` is drawn only when the document has a `touchstart` listener.
  [Touch](ui/touch.md)
- `select()` is ignored on the hidden `readonly` textarea a copy uses, so the
  text is also picked with `setSelectionRange`. [Frontend](design/frontend.md)
- Safari draws the page gone back to under its own swipe back, and a tab of
  Safari has that swipe; an app from the home screen has none.
  [Phone](ui/phone.md)
- With the bars of mobile Safari out, a picture capped in `vh` and its caption
  stood taller than the dialog. [Pages](ui/pages.md)

## WebKit

- A page just put in is painted once at rest before an animation takes it, so
  the start of a move is also held inline. [Phone](ui/phone.md)
- A long note is painted again on every move of a drag unless the dragged page
  is a layer of its own. [Phone](ui/phone.md)

## Phones and touch screens

- A tap latches `:hover` onto what it landed on until the next tap somewhere
  else. [Themes](design/themes.md)
- A phone's keyboard covers the bottom of the page without making it shorter,
  so a field fixed to the bottom sits under the keys. [Phone](ui/phone.md)

## Browsers

- A plain http page that is not localhost has no clipboard api.
  [Frontend](design/frontend.md)
- A page cannot read a drag's data during `dragover`. [Entries](ui/entries.md)
- A scroll event says an element moved, never who moved it, and the echo of a
  programmatic scroll arrives a frame later.
  [Editor position](design/editor-position.md)
- `overflow-x: hidden` makes an element a scroll container, and every sticky
  bar inside it stops sticking; `clip` does not. [Phone](ui/phone.md)
- A fixed element inside a scaled element is placed in that element.
  [Touch](ui/touch.md)
- A table that scrolls by itself is only as wide as its text.
  [Look](ui/look.md)
- A table column reads a percentage inside `clamp()` as `auto`, so the name
  column of a folder's table is sized in `cqw`.
- A regular expression in javascript cannot be stopped from inside, only the
  worker it runs in. [Search](design/search.md)
- `document.currentScript` is set only while the script runs.
  [Site](design/site.md)
- A live region put in together with its text is not reliably read out, a
  tooltip on an `<svg>` never opens on keyboard focus, and an `aria-label` on
  an element with no role is not reliably read.
  [Remote sync](design/remote-sync.md#sync-state)
- On a Mac, Option+C types `ç`, so a shortcut with Alt is matched on `code`.
  [Frontend](design/frontend.md)

## Firefox and Chromium from disk

- A page opened from disk has the origin `null` in Firefox.
  [Site](design/site.md)
- Between pages opened from disk Firefox shares only the cookie and Chromium
  only the storage. [Site](design/site.md)
- A page opened from disk can load no module, fetch nothing and put no other
  file in the address bar. [Site](design/site.md)

## Printing

- `beforeprint` leaves no time for a redraw. [Command line](design/cli.md)
- Safari cannot repeat a block's padding on every printed page.
  [Command line](design/cli.md)
- With no page margin set on the body alone, Firefox gave the margins back from
  the third printed page. [Command line](design/cli.md)

## React, mantine and the editor

- React hands a press inside a portal up to the component the portal belongs
  to. [Sidebar](ui/sidebar.md)
- When a menu item puts a field on the page, mantine's menu gives the focus
  back to its button a tick after the field took it. [Entries](ui/entries.md)
- Mantine's runtime css variables sit under its own attribute and outrank a
  theme's, so the app runs it with `withCssVariables={false}`.
  [Themes](design/themes.md)
- Mantine writes a modal's transition inline, which outranks the stylesheet.
  [Pages](ui/pages.md)
- Mantine's `setColorScheme` turns every transition off for a moment with
  `* { transition: none !important }`, so the theme picker's indicator jumped
  while every other choice slid. [Look](ui/look.md)
- A hidden mantine rail is only moved out of sight, and its rows still answer
  the tab key. [Sidebar](ui/sidebar.md)
- A mantine menu's outside tap closes it on `touchstart`, and the click goes on
  to the row underneath. [Touch](ui/touch.md)
- Mantine writes lengths as `calc(3rem * 1)`, which no parse of the string
  reads, so the topbar height is measured on a hidden probe.
- A `Menu` or `Popover` unmounts its dropdown as it closes, so what must
  outlive the menu lives with its trigger or in a provider above it: the
  export's print waits for formulas after the menu is gone, and the reset
  dialog opens from the sync popover.
- `PopupMenu` uses `floatingStrategy="fixed"`: a menu placed in the page moved
  the page, because the focus it takes on opening scrolled to where it stood
  before it was placed.
- react-codemirror wraps the editor in a div with `display: block` and no
  height, so the stylesheet makes that div a flex child, or the editor grows to
  the whole document and nothing scrolls.
- In codemirror the height of a line not drawn yet is an estimate, hundreds of
  pixels off in a wrapped note. [Editor position](design/editor-position.md)
- A phone that puts a tab away and later drops it fires no `beforeunload`, so a
  draft is also saved on `pagehide`.
- A paste that carries `text/plain` is never taken as a picture: Word and Excel
  put a picture on the clipboard beside the text.
- Rolldown names a chunk after its file, so the index of every codemirror
  language came out as `dist`, `dist2` and on. [Frontend](design/frontend.md)

## Mermaid, PlantUML and KaTeX

- Mermaid takes no nonce and measures its labels in a scratch svg under a
  `<style>` of its own. [ADR 7](adr/0007-inline-styles-allowed.md)
- Mermaid finds its scratch element by id, so every pass renders under fresh
  ids, or the svg already on the page answers for it, and a failed parse leaves
  that element on the body, where it is removed.
- Mermaid mixes colors as if they were opaque, so it gets opaque colors only,
  and `useMaxWidth` is off, because it is the one width mermaid writes inline.
- PlantUML with Viz loaded but its wasm refused draws every Graphviz diagram as
  a crash picture. It falls back to Smetana only when `PLANTUML_VIZ` has no
  `instance`, so a failed start sets it to an empty object: left unset, a
  global `Viz` would answer.
- Viz is a UMD: in a bundle it lands on the module's exports, not on
  `globalThis`, and the engine finds it only through `PLANTUML_VIZ`.
- PlantUML takes a syntax error for a diagram: `renderToString` hands over a
  picture of the source with the line marked. `onError` is for the engine
  failing.
- With nothing set, PlantUML loads `!include <lib>`, emoji and themes as
  `<script>` tags relative to the page. A loader that refuses every file is
  installed, and the themes and the icons are bundled.
- PlantUML writes the same ids into every diagram (`part1`, `msg1`), some twice
  in one, so each diagram's ids get a prefix of its own.
- PlantUML's `maxSvgSize`, 8192 by default, failed a sequence of 400 messages
  (11690px). It is checked after the layout and bounds no work, so it is off.
- PlantUML's dark mode paints `#1B1B1B` behind a Graphviz diagram and nothing
  behind a sequence one; that default backdrop is removed.
- KaTeX's stylesheet says `font-display: block`, so formulas are typeset only
  after its faces load, or they paint blank and the page moves.
- KaTeX empties the node before it builds, so on an error the source is put
  back.

## Git and git hosts

- `reset --keep` replaces an _ignored_ untracked file without a word.
  [ADR 11](adr/0011-reset-keep.md)
- A trial merge runs a merge driver the repository config names, and a driver's
  name is looked up in the config first, where even `text` can be a command.
  [Remote sync](design/remote-sync.md#conflicts-and-reset)
- A repository's config and its `.gitattributes` each name commands git runs
  during an ordinary commit: hooks, `core.fsmonitor`, filters. A diff driver
  and a textconv filter are commands it names too, run on diff and log.
  [History](design/history.md)
- Git will not descend into an excluded directory, and a `.gitignore` among the
  notes outranks anything scrawl writes. [History](design/history.md)
- A path stops resolving against an older revision once a rename sits in
  between. [History](design/history.md)
- A shallow clone breaks the log and the push.
  [Remote sync](design/remote-sync.md#startup)
- A push with no credential fails as "could not read Username, terminal prompts
  disabled". [Remote sync](design/remote-sync.md#sync-state)
- Git keeps no delta between two gzip files.
  [ADR 3](adr/0003-gzip-assets-out-of-git.md)
- The git endpoint of github.com takes only `Basic`, Bitbucket only `Bearer`,
  and a host answers a header it cannot parse with a bare `400`, half a minute
  into a clone. [Remote sync](design/remote-sync.md#credentials)
- GitHub documents a webhook delivery body of up to 25 MB.
  [Remote sync](design/remote-sync.md#webhook)

## Linux, Go and wasm

- On Linux a bare chmod event also comes with a delete; inotify is not reliable
  on a bind mount or a network share, and its queue overflows without a word
  under an rsync. [Storage](design/storage.md#watching)
- `os.Root` follows no symlink when `O_CREATE|O_EXCL` are both set.
  [Storage](design/storage.md#writes)
- Without a sync of the file and its directory, a power cut left a renamed file
  with the right name and no content. [Storage](design/storage.md#writes)
- `/proc/<pid>/cmdline` is world readable.
  [Remote sync](design/remote-sync.md#credentials)
- `ServeMux` panics on a methodless pattern beside a catch-all that narrows
  another way. [Remote sync](design/remote-sync.md#webhook)
- wazero watches a context only when every branch of the compiled code checks
  it, which made a prettier run five times slower.
  [ADR 6](adr/0006-prettier-in-worker-processes.md)
