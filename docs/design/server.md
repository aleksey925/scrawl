# Server

Spaces, routes, settings and the guards on every request.

## Spaces and settings

- A space is the unit the server is built around: one store, one renderer, one
  index, one history service, named and served under `/s/<name>/`.
  `server.Space` holds them and every handler that reads one hangs off
  `mount{*Web, spc}`, so each is still written against a single store. The name
  is always written down by a human - mandatory `--space.name`, mandatory
  `name:` ([ADR 8](../adr/0008-space-names-by-hand.md)).
- Settings split by what they describe. The server's are flags and variables
  and always apply. A space's are the `--space.*` and `--repo.*` flags for one
  space, or the keys of `--spaces-file` for several, and the file replaces
  every one of those flags. The file holds nothing else: a server setting in
  both places would need a precedence rule. A key left out of the file takes
  the default its flag has, so one space reads the same written either way.
- Global read-only is a ceiling and a space's own is a floor: the effective
  mode is `global || space`, and that one value is what `/api/me` reports and
  what every write is refused on. A per-space `read_only: false` cannot lift
  the server-wide guard.

## Routes and URLs

- Everything a space owns lives under `/s/<name>/`, including when there is
  exactly one: `/doc/`, `/edit/`, `/history/`, `/search`, `/recent`, `/api/`
  and `/raw/`. The root holds only what reads no store - `/ping`, `/static/`,
  `/manifest.webmanifest`, `/login`, `/logout`, `/api/login`, `/api/logout`,
  `/api/spaces` and the `/` redirect to the first space. Every new endpoint
  answers one question, does it read a store, and lands on one side.
- Two kinds of URL, and they must never be mixed. A **router-relative** one
  goes to `<Link to>` or `navigate()`, which prepend the space's basename
  themselves, so it carries no prefix - every builder in `view` produces one,
  `edit_url` included. A **physical** one is fetched by the browser directly -
  a `fetch`, an `href` the renderer wrote into a note, `/raw/`, `/static/` -
  and carries the prefix. The base is the prefix with no trailing slash and a
  path always has a leading one, so a physical url is `base + path` and nothing
  ever concatenates a bare segment. The reader asks the platform for it and
  never builds one: on a site a physical url is the file a route is written to,
  `/doc/a/b.md` is `a/b.html`, `/doc/a/` is `a/index.html` and
  `/doc/a/index.md` is `a/index.md.html`, relative to the page.
- Every file has a page under `/doc/`: a note is rendered, a picture is
  previewed from `/raw/`, a text file is highlighted by `render` up to its own
  small cap and plain above it, and any other file offers its download. The
  text list is one list in the server, and bytes that are not UTF-8, or hold a
  NUL, are not text whatever the name. A link in a note goes to a file's page
  and an embedded picture to `/raw/`, because the browser fetches a picture as
  bytes. The line numbers of a text file are a CSS counter and never text, so a
  copy holds only the source. A file's page is the app's alone: a site links a
  file to its copy, so the file view is plugged into the reader and never
  imported by it. `File.RawURL` is the one physical url in JSON; the reading
  side mounts it.

## Guards

- Write endpoints require auth and CSRF, and are refused in read-only mode. A
  `Bearer` API token authenticates instead of the cookie, gets no session and
  skips the cross-origin check; a `:ro` token is refused the same writes the
  server-wide read-only mode refuses.
- All rendered HTML is sanitized. Raw HTML in markdown is allowed, but only
  through the bluemonday policy in `render`, which starts from `NewPolicy`
  because a policy can only ever be widened afterwards.
- `/raw/` never serves an executable document. The content type comes from an
  allowlist keyed on the extension, or on the whole name for the few text files
  that have none (`Makefile`, `Dockerfile`, `go.mod`), anything outside it is a
  download, and the route carries its own `default-src 'none'; sandbox` policy
  on top of `nosniff`. A file with no extension is never sniffed.
- Rendering is superlinear on some inputs, so every render is bounded by a size
  cap and a deadline, and the whole server by a small throttle.
- `script-src` is `'self'` with nothing inline, and that is the line that stops
  a script. It also has `'wasm-unsafe-eval'`, which compiles WebAssembly and
  runs no script: Graphviz lays out PlantUML that way
  ([ADR 17](../adr/0017-plantuml-in-the-browser.md)). Styles are
  `'self' 'unsafe-inline'`, the way github.com has them
  ([ADR 7](../adr/0007-inline-styles-allowed.md)). A note cannot carry a style
  either way: the bluemonday policy refuses the element and the attribute
  whatever the header allows.

## Lifecycle

- Every background goroutine runs under a worker context canceled the moment
  `srv.Run` returns, and that cancel is called rather than deferred. `Web.Run`
  returns as soon as `ListenAndServe` fails while its context is still live, so
  a wait on a goroutine that only exits with that context would hang the
  process on a busy port.
