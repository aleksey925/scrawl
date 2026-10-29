# scrawl web

The React + Mantine single page app, and the reader the pages of the
command line run. It is built into `server/assets/app/` and
`page/assets/`, which are committed to git and embedded by the Go
server and the `page` package with `//go:embed`.

## Develop

The dev server proxies everything the app talks to, so it needs a real
binary behind it. In one terminal:

```
make run          # serves ./examples/data as the "notes" space on :7272
```

In another:

```
cd web
npm install
npm run dev       # http://localhost:5173
```

The proxy is required, not a convenience: the server's CSRF check is
`Sec-Fetch-Site` based, so a mutating request has to look same-origin.
CORS cannot make that work.

Proxied to `http://127.0.0.1:7272`: `/api`, `/raw`, `/static`,
`/logout`, `/ping`, `/manifest.webmanifest`, plus `/s` and `/login`.
The first group is the server's alone. `/s` and `/login` are shared: a
browser navigation to an app route is answered with Vite's `index.html`
and everything else on them still reaches the server, so deep links work
in both directions.

`/plantuml` is proxied to `/static/dev/plantuml`. A built app asks for
PlantUML's library next to its bundle, `../../plantuml/` from
`/static/<digest>/app/assets/`, and from the source the dev server
serves that comes out as `/plantuml/`.

The bypass is decided on the path and not on the `Accept` header alone.
A space owns its whole subtree now, so `/s/<name>/api`, `/s/<name>/raw`
and `/s/<name>/hook` always proxy: an attachment opened as a top-level
navigation carries `Accept: text/html` like any other, and deciding on
the header would hand it `index.html` and never ask the raw handler.

**The dev shell's base is a constant.** The Go shell hands the client its space
prefix, and `web/index.html` hardcodes `data-base="/s/notes"` to match the
`--space.name=notes` that `make run` passes. Running the backend with another
space name means editing that attribute too.

## Build

```
cd web
npm run build     # tsc --noEmit, then vite build for the app and the pages
```

The app goes to `server/assets/app/`:

```
server/assets/app/index.html
server/assets/app/manifest.json
server/assets/app/assets/*.js
server/assets/app/assets/*.css
```

The pages of `render`, `diff` and `site` get their scripts and
stylesheets in `page/assets/`, built by `vite.page.config.ts`, one
classic script per entry, because a page opened from disk can load no
module.

The build output is committed. `node_modules/` is not.

### Vite base path and file names

`base` is `./` for a build and `/` for the dev server, and the file
names carry no hash: `assets/EditPage.js`, not `assets/EditPage-3f9a1c.js`.
A rebuild changes in git only the files whose content changed.

The server takes a digest of the embedded bundle at startup and serves the
bundle under `/static/<digest>/app/`. The shell names the entry, its CSS
and its preloads under that address, and a relative base makes every chunk
a page imports later resolve against the module that imports it, so it
carries the same digest. Vite's own `index.html` is not used.

Only the current digest is answered, with a cache of a year. A page left
open across an upgrade finds its next chunk gone: `vite:preloadError`
fires and `src/staleBundle.ts` loads the page again, at the address the
click was going to.

A chunk made of a package's index is named after the package
(`codemirror-lang-python.js`), not after the file (`dist2.js`). Names
like `c4Diagram-YGBWAQC7.js` are mermaid's own file names and change only
with its version.

The pages are one vite build per entry, because rolldown splits chunks whenever
a build has more than one input, and a script inlined into a page cannot load a
chunk. A chunk name never starts with `_` or `.`, which `go:embed` skips.

### Manifest

`build.manifest` is set to the plain name `manifest.json` rather than
Vite's default `.vite/manifest.json`. `go:embed` on a directory skips
dot-prefixed entries, so the default would embed the bundle and none of
its index. The Go side parses `server/assets/app/manifest.json` to find
the entry chunk plus the CSS it needs (Vite's backend integration
pattern).

`build.assetsInlineLimit` is `0`. The CSP allows `img-src 'self' data:`
but not fonts from `data:`, and an inlined font would fail at runtime
with nothing in the build output hinting at why.

## Contract with the Go server

The server renders the shell, so three things have to line up.

**Theme.** The choice lives in the `theme` cookie, values `auto` or
the id of a theme. For a theme the server puts it and its scheme on
the root element before the first byte, and on `auto` neither:

```
<html data-scrawl-theme="dark" data-mantine-color-scheme="dark">
```

The client writes the cookie and both attributes on every change. Mantine's
`ColorSchemeScript` is deliberately not used: it emits an inline
`<script>`, and `script-src` is `'self'`. On `auto` and on the dev
server the client sets the scheme from the cookie and the system before
React mounts.

**Mount node.** The shell has to contain `<div id="scrawl-app-root">`.

## Themes

A theme is one JSON file in `theme/themes/` at the root of the
repository; the file name is its id. To add one, copy `light.json` or
`dark.json`, change the values and run `make ui`. Nothing else names a
color of a theme.

- `name` is what the pickers show.
- `scheme` is `light` or `dark`: what the browser draws for a form
  control, and the editor and diagram defaults.
- `code` is six colors of code: `keyword`, `string`, `comment`,
  `function`, `number` and `builtin`. `render` builds a chroma style
  from them.
- `strongWeight` is the weight of bold in a note.
- `currentWeight` is the weight of the current row of the sidebar.
- `fontSmoothing` is `auto` or `antialiased`: how a Mac draws the letters.
- `palette` is every token of `Palette` in `src/themes.ts`, Notion's
  color roles. The note and the chrome both read it as `--scrawl-<key>`.
- `blocks` is Notion's nine block colors, a text and a ground each, as
  `--scrawl-color-<name>` and `--scrawl-bg-<name>`.
- `shadows` is `small`, `medium` and `large`, as
  `--scrawl-shadow-<name>`.
- `colors`, optional, replaces mantine's `accent`, `gray` or `dark`
  scale of `src/theme.ts`.

`light` and `dark` have to exist: they are what Auto follows. The go
tests and the build both refuse a theme with a token missing.

In both entries the theme stylesheet is imported after mantine's own: it
replaces their defaults at equal specificity, so the order of the imports
decides.

## Two rules

**Breakpoints have one home.** They are defined in
`src/breakpoints.json`, exported from `src/theme.ts` as `breakpoints`,
`breakpointPx`, `minWidthQuery`, `maxWidthQuery`, `useAtLeast` and
`useBelow`, and fed to PostCSS as `$mantine-breakpoint-*` by
`postcss.config.cjs`. Which breakpoint a piece of layout belongs to is
named in `layoutBreakpoints` (`phone`, `sidebar`, `compactTopbar`,
`splitPane` and others).

No component may hardcode a pixel width or read `window.innerWidth`.
The old frontend had CSS at 767/899/999/1199 and JS at 900/1000, they
drifted, and the drawer closed at a different width than the one that
hid the sidebar.

**Rendered notes do not share an id namespace with app chrome.** A note
is markdown the reader wrote, and its headings become element ids. A
heading called "Toasts" or "Lightbox" produces `id="toasts"`, which is
exactly how the previous app lost its own elements.

So app chrome is never looked up by a bare id. Overlays come from
Mantine (`Drawer`, `Modal`, `Menu`), which own their own portals,
focus trap and `inert`; shell slots are reached through refs the shell
holds (`src/shell/ShellSlots.tsx`) and filled with React portals. The
one id in the app is the mount node, read once before any note exists.

Html from the server is injected in three components only:
`src/components/DocumentHtml.tsx` for a note, `src/diff/RenderedDiff.tsx`
for the two sides of a version and `src/shell/FileView.tsx` for a
highlighted text file. It is safe because the server made it: a note and a
diff side are sanitized with the bluemonday policy in `render/policy.go`,
and a text file is highlighted by `render` from escaped source. Keeping the
injection in these three places keeps that trust boundary small. The one
other `dangerouslySetInnerHTML` is `src/shell/AppLogo.tsx`, which draws the
logo, a file of the bundle and never input.

## Browser and library quirks

They are kept with the others in [`docs/quirks.md`](../docs/quirks.md).
