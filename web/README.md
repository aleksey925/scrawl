# scrawl web

The React + Mantine single page app. It is built into
`server/assets/app/`, which is committed to git and embedded by the Go
server through the existing `//go:embed assets`.

## Develop

The dev server proxies everything the app talks to, so it needs a real
binary behind it. In one terminal:

```
make run          # serves ./examples/data as the "notes" project on :7272
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
`/logout`, `/ping`, `/manifest.webmanifest`, plus `/p` and `/login`.
The first group is the server's alone. `/p` and `/login` are shared: a
browser navigation to an app route is answered with Vite's `index.html`
and everything else on them still reaches the server, so deep links work
in both directions.

The bypass is decided on the path and not on the `Accept` header alone.
A project owns its whole subtree now, so `/p/<name>/api`, `/p/<name>/raw`
and `/p/<name>/hook` always proxy: an attachment opened as a top-level
navigation carries `Accept: text/html` like any other, and deciding on
the header would hand it `index.html` and never ask the raw handler.

**The dev shell's base is a constant.** The Go shell hands the client
its project prefix, and `web/index.html` hardcodes
`data-base="/p/notes"` to match the `--project notes` that `make run`
passes. Running the backend with another project name means editing that
attribute too.

## Build

```
cd web
npm run build     # tsc --noEmit, then vite build
```

Output goes to `server/assets/app/`:

```
server/assets/app/index.html
server/assets/app/manifest.json
server/assets/app/assets/*.js
server/assets/app/assets/*.css
```

The build output is committed. `node_modules/` is not.

### Vite base path

`base` is `/static/spa/app/` for a build and `/` for the dev server.

Assets are served under `/static/{version}/app/...` and the Go handler
ignores the version segment on lookup, so any literal in that slot
resolves to the same file. A relative base would not work, because
`index.html` is served from arbitrary URLs (`/p/notes/doc/a/b.md`), and the
version cannot be baked in at build time, so the segment is the fixed
placeholder `spa`. Nothing is lost: Vite content-hashes every file
name, which is what actually busts the cache.

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

**Theme.** The choice lives in the `theme` cookie, values `auto`,
`light` or `dark`. The server reads it and puts the resolved scheme on
the root element before the first byte:

```html
<html data-mantine-color-scheme="light|dark" data-theme="auto|light|dark">
```

The client takes `data-mantine-color-scheme` as its starting value and
writes the cookie on every change. Mantine's `ColorSchemeScript` is
deliberately not used: it emits an inline `<script>`, and `script-src`
is `'self'` with no nonce. Without the server attribute (the dev
server) the client sets it from the cookie before React mounts.

**Style nonce.** The server puts the per-response nonce in one meta
tag:

```html
<meta name="csp-nonce" content="...">
```

`src/nonce.ts` is the only reader. It feeds `getStyleNonce` on
`MantineProvider` and also calls `setNonce` from the `get-nonce`
package, because `react-remove-scroll` (behind `Drawer` and the modals)
takes its nonce from there and not from Mantine. An empty or missing
meta means no nonce, which is what the dev server serves.

**Mount node.** The shell has to contain `<div id="scrawl-app-root">`.

## Two rules

**Breakpoints have one home.** They are defined in
`src/breakpoints.json`, exported from `src/theme.ts` as `breakpoints`,
`breakpointPx`, `minWidthQuery`, `maxWidthQuery`, `useAtLeast` and
`useBelow`, and fed to PostCSS as `$mantine-breakpoint-*` by
`postcss.config.cjs`. Which breakpoint a piece of layout belongs to is
named in `layoutBreakpoints` (`sidebar`, `tocRail`, `compactTopbar`).

No component may hardcode a pixel width or read `window.innerWidth`.
The old frontend had CSS at 767/899/999/1199 and JS at 900/1000, they
drifted, and the drawer closed at a different width than the one that
hid the sidebar.

**Rendered notes do not share an id namespace with app chrome.** A note
is markdown the reader wrote, and its headings become element ids. A
heading called "Toasts" or "Lightbox" produces `id="toasts"`, which is
exactly how the previous app lost its own elements.

So app chrome is never looked up by a bare id. Overlays come from
Mantine (`Drawer`, `Modal`, `Spotlight`), which own their own portals,
focus trap and `inert`; shell slots are reached through refs the shell
holds (`src/shell/ShellSlots.tsx`) and filled with React portals. The
one id in the app is the mount node, read once before any note exists.

Note html is injected in exactly one component,
`src/components/DocumentHtml.tsx`. It is safe because the server
sanitized it with the bluemonday policy in `render/policy.go`, and
keeping the injection in one place keeps that trust boundary to one
file.
