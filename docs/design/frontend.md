# Frontend

How the react app in `web/` is built, shipped and wired.

## Build and release

- The frontend is a react and mantine app in `web/`. It owns the whole origin:
  every page route boots the same shell and the client router decides what it
  is. `server/templates/` holds one page, the sign-in form, because it has to
  work before the bundle loads and with javascript off.
- Nothing is fetched from a CDN at runtime, and the build stays out of the
  release path: vite writes into `server/assets/app/` and `page/assets/`, which
  are committed and picked up by `//go:embed`
  ([ADR 1](../adr/0001-committed-frontend-build.md)). `make ui` rebuilds it and
  CI fails when what is committed is stale.
- The bundle's file names carry no hash, so a rebuild changes in git only the
  files that changed ([ADR 2](../adr/0002-bundle-names-without-hash.md)). The
  release is told apart by the address instead: `/static/<digest>/app/`, the
  digest of the embedded bundle, which the server takes at startup and vite's
  relative base passes on to every chunk a page imports later. The server
  answers that digest only, and lets a browser keep the files a year. A page
  left open across an upgrade finds its next chunk, or the find's worker, gone
  and loads again, at the address it was going to, unless leaving would ask
  about unsaved changes: a reload that prompt refused left every chunk waiting
  for a page that never came. A chunk made of a package's index is named after
  the package: rolldown names it after the file, and the index of every
  codemirror language came out as `dist`, `dist2` and on in the order met, so
  one language more renamed the rest.
- A release embeds the bundle, the pages' assets, the formatter and the
  server's PlantUML engine gzip-compressed, under the `gzassets` build tag:
  `make build`, the image and goreleaser run `go run ./gzassets/pack` first,
  which writes the copies into each package's `gzassets/`, kept out of git
  ([ADR 3](../adr/0003-gzip-assets-out-of-git.md)). A build without the tag
  embeds the committed files as they are, so `go install` and a fresh clone
  keep building. A file stored compressed is read through `gzassets` and goes
  out as stored to a client that accepts gzip, so the server spends nothing
  compressing it.
- PlantUML's library is the one exception: `plantuml/library/` is committed
  compressed and read the same way in every build
  ([server](server.md#plantuml)).

## App

- Breakpoints have one home, `web/src/breakpoints.json`, reached through the
  theme. No component reads `window.innerWidth` or names a pixel width. The old
  stylesheet answered at 767/899/999/1199 while the javascript answered at
  900/1000, and the drawer closed at a different width than the one that hid
  the sidebar.
- A screen keeps the answer it has while it fetches the next one, and answers
  are remembered across a route swap (`useApi`, cleared whole by any mutation).
  Clearing the data before the request blanked the tree, the note and every
  control on every click, for the length of a round trip. What a click may not
  wait for is the highlight: the current row comes from the route and never
  from the answer.
- The file on screen is the route. A folder is always its list, so a note is
  shown under its own address only, and a per-file signal keys off the route.
- Rendered notes never share an id namespace with app chrome. A heading becomes
  an element id, so a note carrying "Toasts" took `id="toasts"` and every toast
  was appended invisibly inside it. Chrome is mantine components, portals and
  refs, never a bare id lookup.
- A global shortcut gives way to an editor. It does nothing when the event was
  already handled or was pressed inside an element that owns the app's
  shortcuts (`data-owns-shortcuts`), because a keymap may leave a key
  unhandled, bold inside a code block, and the sidebar must not toggle while
  typing. Every shortcut is a row of the one table in `ShortcutHelp`, which
  shows only the rows the place offers. A shortcut with Alt is matched on the
  key's `code`, never its `key`: on a Mac Option+C types `ç`.
- Every copy goes through `copyText` in `web/src/reader/clipboard.ts`, never
  `navigator.clipboard` alone: a phone that opens the server by its address on
  the network is on plain http, where the page has no clipboard api, and Copy
  link failed there while it worked on localhost. Without the clipboard api it
  copies through a hidden `readonly` textarea and `execCommand`: `readonly`
  keeps a phone's keyboard down, and the text is picked with
  `setSelectionRange` as well as `select()`, because iOS ignores `select()`
  there.
- A panel that covers the page is mantine's `Drawer`, which owns the `inert`
  behind it, the focus it took and which single panel is up. The drawer and the
  outline sheet once each ran their own copy of that over overlapping elements,
  so closing one lifted the other's `inert`, and a close that went around the
  teardown left the page taking no tap at all.

## Diagrams

- `web/src/reader/diagrams.ts` draws every `pre.mermaid` and `pre.plantuml` of
  a note through one code path. Each kind is an engine: how to load it and how
  to turn a source into an svg. The wrapping, the placeholder, the error note,
  the scroll keeping and the redraw on a theme change are shared.
- An engine is a lazy chunk, loaded through the platform's `loadMermaid` or
  `loadPlantUML` only by a note that has a block of its kind. The kinds load
  and draw side by side, so a mermaid diagram does not wait for PlantUML's
  engine. Within a kind the blocks are drawn one at a time, since a drawing
  holds the main thread and cannot be stopped. A canceled pass stops between
  two blocks. Each diagram is put in as soon as it is drawn.
- The whole pass goes to `track` in `pending.ts`, which a PDF waits for, so a
  print has every diagram drawn.
- Every pass draws under fresh ids, `md-<kind>-<pass>-<index>`. PlantUML's own
  ids get that prefix too, and every `url(#...)` and `href="#..."` that points
  at one follows (`scopeIds` in `diagramSvg.ts`): every PlantUML diagram
  carries the same ids, and a heading of the note may be called that too.
- The viewer shows a copy of the diagram. The copy gets ids of its own, with an
  `md-viewer` prefix, and its `<style>` follows them, so the ids in the note
  and the viewer's are never the same while it is open.
- A mermaid svg with `width="100%"` gets the number of its `max-width` as its
  width ([quirks](../quirks.md#mermaid-plantuml-and-katex)), so every diagram
  has a real width, in the note and in the viewer.
- PlantUML loads a library file as a script from an address relative to its own
  chunk, `../../plantuml/` in the app and `plantuml/` beside the scripts of a
  site, so the same chunk finds it under any path the app or the site is served
  from.
