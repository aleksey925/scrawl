# Frontend

How the react app in `web/` is built, shipped and wired.

## Develop

- The dev server proxies everything the app talks to, so it needs a real binary
  behind it: `make run` in one terminal, which serves `./examples/data` as the
  "notes" space on :7272, and `npm install` and `npm run dev` in `web/` in
  another, which serves `http://localhost:5173`. The proxy is required, not a
  convenience: the server's CSRF check is `Sec-Fetch-Site` based, so a mutating
  request has to look same-origin. CORS cannot make that work.
- Proxied to `http://127.0.0.1:7272`: `/api`, `/raw`, `/static`, `/sw.js`,
  `/logout`, `/ping`, `/manifest.webmanifest`, plus `/s` and `/login`. The
  first group is the server's alone. `/s` and `/login` are shared: a browser
  navigation to an app route is answered with Vite's `index.html` and
  everything else on them still reaches the server, so deep links work in both
  directions. `/plantuml` is proxied to `/static/dev/plantuml`: a built app
  asks for PlantUML's library next to its bundle, `../../plantuml/` from
  `/static/<digest>/app/assets/`, and from the source the dev server serves
  that comes out as `/plantuml/`.
- The bypass is decided on the path and not on the `Accept` header alone. A
  space owns its whole subtree, so `/s/<name>/api`, `/s/<name>/raw` and
  `/s/<name>/hook` always proxy: an attachment opened as a top-level navigation
  carries `Accept: text/html` like any other, and deciding on the header would
  hand it `index.html` and never ask the raw handler.
- The dev shell's base is a constant. The Go shell hands the client its space
  prefix, and `web/index.html` hardcodes `data-base="/s/notes"` to match the
  `--space.name=notes` that `make run` passes. Running the backend with another
  space name means editing that attribute too.
- The dev shell has no release. `web/index.html` carries no `data-version`, and
  the offline copy reads only the answers of the shell's release, so reading
  offline does not work against `npm run dev`. Try it against the binary.
- Run does not work against the dev server. An app host is on the port of the
  page, `app-<id>.localhost:5173`, which the dev server does not proxy to the
  binary. Try HTML apps against the binary.

## Build and release

- The frontend is a react and mantine app in `web/`. It owns the whole origin:
  every page route boots the same shell and the client router decides what it
  is, so the shell preloads no page of a route: the page's chunk comes after
  the entry. Preloading it by route saved one round trip only on the first open
  after a release, for a second table of the routes in Go. `server/templates/`
  holds one page, the sign-in form, because it has to work before the bundle
  loads and with javascript off.
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
  and loads again, at the address it was going to or else at its own, unless
  the editor holds unsaved text: a reload that the browser's prompt refused
  left every chunk waiting for a page that never came. The editor tells the
  reload so through `holdReload` in `staleBundle.ts`, not through a
  `beforeunload` event: it holds the reload whenever its text is unsaved, kept
  as a draft or not, as a reload in the middle of typing loses the place and
  the undo, and lets go once the person has left the editor. Its `beforeunload`
  listener answers only the browser, and asks only when the draft could not be
  kept or a picture is still uploading.
- A chunk made of a package's index is named after the package: rolldown names
  it after the file, and the index of every codemirror language came out as
  `dist`, `dist2` and on in the order met, so one language more renamed the
  rest.
- A release embeds the bundle, the pages' assets, the formatter and the
  server's PlantUML engine gzip-compressed, under the `gzassets` build tag:
  `make build`, the image and goreleaser run `go run ./gzassets/pack` first,
  which writes the copies into each package's `gzassets/`, kept out of git
  ([ADR 3](../adr/0003-gzip-assets-out-of-git.md)). A build without the tag
  embeds the committed files as they are, so `go install` and a fresh clone
  keep building. A file stored compressed is read through `gzassets` and goes
  out as stored to a client that accepts gzip, so the server spends nothing
  compressing it.
- `npm run build` in `web/` runs `tsc --noEmit` for the app and the workers,
  then a vite build for the app, the workers and the pages. The app goes to
  `server/assets/app/` (`index.html`, `manifest.json`, `assets/*.js` and
  `assets/*.css`), and the workers where the bullets below say. The pages of
  `render`, `diff` and `site` get their scripts and stylesheets in
  `page/assets/`, built by `vite.page.config.ts`, one classic script per entry,
  because a page opened from disk can load no module. The pages are one vite
  build per entry, because rolldown splits chunks whenever a build has more
  than one input, and a script inlined into a page cannot load a chunk. A chunk
  name never starts with `_` or `.`, which `go:embed` skips.
- `build.manifest` is the plain name `manifest.json` rather than Vite's default
  `.vite/manifest.json`. `go:embed` on a directory skips dot-prefixed entries,
  so the default would embed the bundle and none of its index. The Go side
  parses `server/assets/app/manifest.json` to find the entry chunk plus the CSS
  it needs. `base` is `./` for a build and `/` for the dev server.
- `build.assetsInlineLimit` is `0`. The CSP allows `img-src 'self' data:` but
  not fonts from `data:`, and an inlined font would fail at runtime with
  nothing in the build output hinting at why.
- The offline copy's worker is a classic script of its own, built from
  `web/src/sw/` by `vite.sw.config.ts` into `server/assets/sw/sw.js` and
  checked by `tsconfig.sw.json` with the worker's types. It imports only
  `web/src/offline/keys.ts` and the `web/src/contentPath.ts` it uses, which
  touch no DOM. The worker keeps the app version before its own, so a page left
  open on it still finds its next chunk
  ([offline copy](offline.md#the-worker)).
- The two scripts of an HTML app's host, the enter page's and its worker, are
  built from `web/src/htmlapp/` by `vite.htmlapp.config.ts`, one IIFE file
  each, into `server/assets/htmlapp/enter.js` and `sw.js`. The worker is
  checked by `tsconfig.sw.json` with the worker's types and shares
  `web/src/sw/range.ts`, the 206 cut from a stored body, with the copy's
  worker. `appOnly` of `vite.page.config.ts` lists `src/htmlapp/` and
  `pages/RunPage`, so a page of the command line or a site that imports them
  fails its build ([HTML apps](html-apps.md#offline)).
- The dialogs of Search, Move to and Replace local copy are chunks of their
  own, in `web/src/shell/dialogChunks.tsx`, and the app loads them when the
  browser is idle after the page has loaded. The first load runs less. The
  pages of a note and, with the right to write, of the editor are loaded on
  idle the same way, in `web/src/pagePreloads.ts`, so the first tap on a note
  or on Edit does not wait for its code. A load on idle that fails does nothing
  on its own (`loadQuietly` in `staleBundle.ts`): it reloaded the page under a
  person who was only reading. The load is marked failed instead, and the way
  to that page, or the dialog opened, then loads the app again as a stale chunk
  does, at the address the click was going to. A page checks the mark once its
  import has come, since the router names that address only after it asked for
  the page ([quirks](../quirks.md#react-mantine-and-the-editor)); a dialog
  changes no address, so it checks before it loads. Both wait first for a load
  on idle of the same chunk that is still on its way. Waiting for the import to
  fail again was not enough: when only a stylesheet failed, the page opened
  with no style, and an import made while vite still waited for that stylesheet
  came without it ([quirks](../quirks.md#browsers)). A page whose mark is set
  and that cannot load the app again, as less than a minute after the last
  time, shows the error page, which asks to load the page again, and the router
  keeps that answer until it is; a dialog shows the toast below. The error does
  not name the import, so while a load on idle is on its way no failed chunk
  reloads from `vite:preloadError`. A chunk the app waits for, a page, a dialog
  opened or a diagram engine, goes through `loadChunk`, which then loads the
  page again itself: a note with math opened at the start lost its KaTeX that
  way. The formatter's chunks go through it as well, and while the editor holds
  unsaved text a failed one only fails that format. A dialog whose chunk is
  there draws in the same render as the click that opened it, with no
  `Suspense`: one that waited for its chunk let the keys typed after Cmd+K go
  to the page, and on a phone its field took the focus outside the tap, so no
  keyboard opened ([quirks](../quirks.md#ios-and-safari)). A dialog opened
  before the idle load is done draws nothing until its chunk comes, and has
  those two faults. That window, from the page's load until the browser is idle
  and the chunks have come, is short and is left open: holding the keys and the
  tap would take a second field drawn in the main bundle. A chunk that does not
  load as the dialog opens loads the page again as a stale chunk does, when the
  editor holds no unsaved text. When it does, a dialog that was opening closes
  with a toast that asks to load the page again: Chromium keeps a failed import
  of a module for the life of the page ([quirks](../quirks.md#browsers)), so
  asking again would fail the same way. Under unsaved text a dialog whose load
  on idle failed closes with that toast too and keeps its mark for the next
  time: vite does not ask for a failed stylesheet again, and the dialog would
  open with no style. The mark is the import's, not its stylesheet's: the
  Search page shares the stylesheet of the Search dialog, so when only that
  stylesheet failed on idle, the Search page, reached from a missing note,
  opens with no style until the page is loaded again. It is rare and loses
  nothing, and a mark per stylesheet would need the chunks' lists of
  stylesheets at run time. Two more cases are left open for the same reason.
  When the app's frame is left, as for the run screen of a mini app, and opened
  again, the dialogs load on idle once more; vite skips the stylesheet that
  failed, the import comes, and the dialog then opens with no style without
  looking at its mark. A page whose import comes after the person went
  elsewhere still loads the app again, at the address they went to or the one
  on screen; unsaved text holds that reload as it holds any other.
- Mantine's styles come in one file per component, listed in
  `web/src/mantine.css`, which the app and a site import, in the order of
  mantine's own `styles.css`. The full file was 277 KB, most of it for
  components scrawl does not use. A component new to the app adds its file
  there, and the files of the components it is built from, or it shows
  unstyled. The order matters: a component's file overrides the files of the
  components it is built from with selectors of the same weight, so it comes
  after them. `default-css-variables.css` is left out: the theme stylesheet
  writes every variable it has, from the same resolver.
- Mantine's files per component write their sizes in px, where `styles.css`
  writes `calc(Nrem * var(--mantine-scale))`, and a browser set to a larger
  font then grew the text but not the buttons and fields around it.
  `web/postcss.config.cjs` turns px into that form in the files under
  `node_modules/@mantine/` only, with the preset's own `autoRem`, which gives
  the declarations of `styles.css` back one for one. The app's own stylesheets
  keep their px. The config takes `autoRem` from the preset's `dist/auto-rem`,
  a file outside the package's entry, so an upgrade of `postcss-preset-mantine`
  checks that the file is still there and works the same.
- An icon carries only the weights the app draws, regular, bold and fill:
  `phosphorWeights` in `web/vite.icons.ts` cuts the other three from each
  icon's drawings as the bundle is built, which halved the icons. Another
  weight draws an empty icon until it is added to `iconWeights`. The dev server
  does not run the plugin on the package it bundles ahead, so there every
  weight draws, and a missing one shows only in a build. The plugin fails the
  build when an icon's file no longer has the six weights it expects, so an
  upgrade of the package that changes their shape is noticed.
- PlantUML's library is the one exception: `plantuml/library/` is committed
  compressed and read the same way in every build
  ([server](server.md#plantuml)).

## App

- The server renders the shell, so it and the client agree on two things. The
  theme choice lives in the `theme` cookie, `auto` or the id of a theme; for a
  theme the server puts it and its scheme on the root element before the first
  byte, `data-scrawl-theme` and `data-mantine-color-scheme`, and on `auto`
  neither. The client writes the cookie and both attributes on every change.
  Mantine's `ColorSchemeScript` is not used: it emits an inline `<script>`, and
  `script-src` is `'self'`. On `auto` and on the dev server the client sets the
  scheme from the cookie and the system before React mounts. The shell has to
  contain an empty `<div id="scrawl-app-root">`, the one id the app reads, once
  before any note exists
  ([ADR 33](../adr/0033-no-logo-while-the-app-loads.md)).
- Html from the server is injected in three components only:
  `components/DocumentHtml.tsx` for a note, `diff/RenderedDiff.tsx` for the two
  sides of a version and `shell/FileView.tsx` for a highlighted text file. It
  is safe because the server made it: a note and a diff side are sanitized with
  the bluemonday policy in `render/policy.go`, and a text file is highlighted
  by `render` from escaped source. Keeping the injection in these three places
  keeps that trust boundary small. The one other `dangerouslySetInnerHTML` is
  `shell/AppLogo.tsx`, which draws the logo, a file of the bundle and never
  input.
- Breakpoints have one home, `web/src/breakpoints.json`, reached through the
  theme: `breakpoints`, `minWidthQuery`, `maxWidthQuery`, `useAtLeast` and
  `useBelow` of `web/src/theme.ts`, `$mantine-breakpoint-*` in PostCSS, and
  `layoutBreakpoints`, which names the one a piece of layout belongs to. No
  component reads `window.innerWidth` or names a pixel width. The old
  stylesheet answered at 767/899/999/1199 while the javascript answered at
  900/1000, and the drawer closed at a different width than the one that hid
  the sidebar.
- On a phone the page's gutter is `--mantine-spacing-lg`, set in
  `web/src/components/Page.module.css`. A band that runs from edge to edge of
  the screen pulls out past the gutter by the same value, so a new gutter has
  to change it too.
- A screen keeps the answer it has while it fetches the next one, and answers
  are remembered across a route swap (`useApi`, cleared whole by any mutation).
  Clearing the data before the request blanked the tree, the note and every
  control on every click, for the length of a round trip. What a click may not
  wait for is the highlight: the current row comes from the route and never
  from the answer.
- `prefetchDir` asks for a folder ahead of its screen and keeps the question in
  one slot with its source and path. A newer question replaces it, and
  `forgetResponses`, a drag given up and three seconds after a swipe let go
  clear it: kept after a drag given up, or after a swipe whose folder never
  came, a screen opened minutes later took an old answer and asked nothing. The
  next screen of that folder that asks the same source takes the question once,
  as its own request (`dirOf`), and asks again if it failed; the copy kept
  offline is another source, and its answer is not the folder online. The
  question never writes to the answers `useApi` keeps: stored when it came, a
  late answer brought back a folder from before a rename or a delete, and an
  older question answered first pushed out the newer one. It is a background
  request, so a refusal sends nobody to sign in while the person stays on the
  page. A site asks nothing ahead (the platform's `prefetch` is false): its
  source answers from the pages it has read, and an older one took the place of
  the fresh page its router had just fetched and seeded.
- `useApi` drops the answer of a run it has canceled, a success as well as an
  error: a source may not watch the signal, the copy's reads do not, and a slow
  answer of the note before would then land under the next one's address.
- The tree is one answer for the whole space, with no mark of the file on
  screen: the app asks `/api/nav`, and `NavProvider` opens the folders on the
  path of the file on screen itself, a folder on screen its own row as well,
  for the server, the site and the offline copy alike. It opens each of them
  once, when the person arrives there, so a folder folded on that page stays
  folded. It asks again on every move, so a file made elsewhere shows up, and
  the server answers with an `ETag` of the tree, so an unchanged tree comes
  back as a 304 with no body. Asked per file, the whole tree came again on
  every tap, though it was the same tree.
- A tree answer `useApi` gets that equals the one it holds keeps the held
  object. A 304 still gives the page a newly parsed answer, and a new tree
  object drew every row of the sidebar a second time on each move, once for the
  move and once for the answer. Only the tree is compared: a page or a folder's
  list is drawn anew with each answer anyway, and turning a whole rendered note
  into a string twice costs a phone with no JIT.
- The file on screen is the route. A folder is always its list, so a note is
  shown under its own address only, and a per-file signal keys off the route.
- A context that many components read carries one kind of value, so a change
  draws only the components that read it. The account (`useAccount`) and the
  tree (`useTree`) are apart: a folder opened or a filter typed draws no note
  again, and a poll of the account draws no tree row. The filter of the tree is
  a third context, read by the sidebar alone, so a letter typed draws no
  folder's list or bar, and the rows take the filter as a deferred value and
  are memoized, so the field shows each key at once and the rows catch up. The
  page chrome's setters are a context of their own, apart from the value, so a
  page that sets its title is not drawn again by its own title. A page sets its
  chrome in a layout effect, before the browser draws: set in an effect, the
  bar on top showed the title of the page before for a frame. A value that
  comes back the same, the account's answer or a scroll that moves nothing,
  keeps the object it had.
- Rendered notes never share an id namespace with app chrome. A heading becomes
  an element id, so a note carrying "Toasts" took `id="toasts"` and every toast
  was appended invisibly inside it. Chrome is mantine components, portals and
  refs, never a bare id lookup.
- Offline the app gives the reader `offlinePlatform`, its own platform with
  `offlineSource`, which reads the copy, and no search or editing. While the
  connection is checked at start it gives `checkingPlatform`, the same with the
  api client behind what the copy does not hold. Swapping the platform runs
  `useApi` again, which keeps the last answer on screen while it loads, so
  going offline or back does not blank the page
  ([offline copy](offline.md#offline-in-the-app)). `mountBase()` takes the
  space from the address when the shell's `data-base` is empty, which is the
  offline shell; a page with no `data-base` at all, a site, has no base.
- A global shortcut gives way to an editor. It does nothing when the event was
  already handled or was pressed inside an element that owns the app's
  shortcuts (`data-owns-shortcuts`), because a keymap may leave a key
  unhandled, bold inside a code block, and the sidebar must not toggle while
  typing. Every shortcut is a row of the one table in `ShortcutHelp`, which
  shows only the rows the place offers. A shortcut with Alt is matched on the
  key's `code`, never its `key`: on a Mac Option+C types `ç`. The editor's own
  `Ctrl`/`Cmd` + `Enter` and `Esc` are the exception: they listen in the
  capture phase, before codemirror, and act only from the text or with nothing
  focused ([editor](../ui/editor.md),
  [quirks](../quirks.md#react-mantine-and-the-editor)).
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
  teardown left the page taking no tap at all. The sheets of a phone are such
  drawers from the bottom: `Sheet` in `web/src/components/Sheet.tsx`, and the
  outline's own, and `useSheetDrag` beside it lets a finger drag either down
  ([phone](../ui/phone.md)).
- A right click on a row of a folder's list, and on the free space of a
  folder's page and of the tree, opens its menu at the pointer, through
  `usePointerMenu` and `FixedAnchor` in `web/src/components/pointerMenu.tsx`. A
  row of the tree opens its menu at its `⋯` button instead, which sits at the
  row's end. The anchor is a fixed box rendered into `document.body`, a point
  here and the menu's box for Move to: while a screen slides in, the page has a
  `transform`, which makes `fixed` relative to it. A row that opens its own
  menu calls `preventDefault`, and the menu of the free space around it opens
  only for an event no one handled yet, never over a link, a button, a field or
  selected text.
- A menu item that puts a name field on the page, New folder or Rename, is a
  `FieldMenuItem`, which tells its `PopupMenu` not to give the focus back to
  its button, or the field would lose it
  ([quirks](../quirks.md#react-mantine-and-the-editor)). A Rename row of a
  sheet turns off the sheet's `returnFocus` for the same reason. Every name
  field in place, in the tree, a folder's list or the bar on top, is
  `NameField`, in `web/src/components/NameField.tsx`, the name of a note's
  draft too. A draft is no rename: the editor owns its name and hands the crumb
  and the phone's bar a `rename` through the page chrome (`useDraftChrome`),
  and the tree draws the faint row from the same chrome. A rename is one
  session held by `FileActionsProvider`: a place asks `useRenamingHere` whether
  the session is its own and draws it with `RenameField`.

## Diagrams

- `web/src/reader/diagrams.ts` draws every `pre.mermaid` and `pre.plantuml` of
  a note through one code path. Each kind is an engine: how to load it and how
  to turn a source into an svg. The wrapping, the placeholder, the error note,
  the scroll keeping and the redraw on a theme change are shared.
- An engine is a lazy chunk, loaded through the platform's `loadMermaid` or
  `loadPlantUML` only by a note that has a block of its kind. The kinds load
  side by side, so a mermaid diagram does not wait for PlantUML's engine. The
  blocks of both kinds are drawn one at a time, through one queue of the pass,
  since a drawing holds the main thread and cannot be stopped: with a loop per
  kind, a mermaid and a PlantUML block waiting for the same move to end were
  drawn in the same task. A canceled pass stops between two blocks. Each
  diagram is put in as soon as it is drawn, and the next one waits for a task
  of its own, so a tap is answered between two drawings. A pass starts only
  when the screen's move on a phone has ended (`screenSettled` in
  `web/src/motion.ts`): drawn during the move, the first note with diagrams of
  a session took twice as long to slide in, with frames held a third of a
  second. A drag of the swipe back and a swiped page's copy still leaving hold
  the pass the same way (`holdScreen`). `screenSettled` waits until no move and
  no hold is left, so a move that starts while it waits is waited for too, and
  every block waits again before it is drawn and before it is put in, as a
  block drawn when the finger came down is put in only after the move, so a
  drag that takes a note sliding in ends its move and still draws nothing under
  the finger.
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
