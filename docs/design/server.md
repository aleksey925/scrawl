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
- A PlantUML diagram drawn in the browser is SVG the engine built from the
  note, after bluemonday ran on the server, so the browser sanitizes it again:
  DOMPurify with its SVG profile, `<style>` refused, handing back a DOM
  fragment, so the markup is not parsed a second time on its way to the page.
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

## PlantUML

- The browser draws every diagram it shows, and the server only those no
  browser will: an exported note and a page of `scrawl render`
  ([ADR 18](../adr/0018-plantuml-on-the-server-and-its-library.md)). There a
  diagram is an `<img>` of an SVG data URL, which runs no script and loads
  nothing, so it is not sanitized; it is drawn in the light theme, as paper is.
  A link in it cannot be clicked, which is the price of the `<img>`. A diagram
  the engine refuses keeps its code, with the reason under it.
- A diagram is a `pre` that has `plantuml` among its classes, the same rule as
  the browser's `pre.plantuml`, so the server and the browser draw the same
  blocks, a fence's and those in the note's own HTML. `render.DiagramBlocks`
  finds them, and a mermaid block the same way. A class that only starts with
  the name, such as `plantuml-source`, is not a diagram.
- The engine runs in worker processes, copies of this binary started with
  `SCRAWL_PLANTUML_WORKER` set, which `main` hands to
  `plantuml.RunWorkerIfAsked` before anything else, as it does for the
  formatter. There is one worker, started on the first diagram.
- A source over 256KB is not handed to the worker. It stays code, with the note
  that it could not be rendered.
- A drawn diagram over 8MB is not handed back by the worker: a small source can
  draw a huge picture, which the server would hold, copy into base64 and copy
  again into the page. The worker answers that it is too large instead, and
  that answer is kept like a refusal: the diagram stays code, with the reason
  under it.
- The pictures of one page take up to 32MB of base64 together. A note can name
  the same diagram thousands of times, and each copy after the first comes from
  the cache at no cost, so without this bound a 2MB note could grow into
  gigabytes of HTML. A diagram that does not fit stays code, with the reason
  under it, and a smaller one after it can still fit.
- A diagram has two minutes, counted from the moment the worker takes it, so
  waiting for the worker behind another export does not use them up. Past them
  the process is killed. That limit is only there to stop an engine that never
  finishes, so it is far above the slowest diagram we know: a C4 one takes 5 to
  10 seconds, the first one in a fresh worker about twice that, and a slow host
  several times more. What a client waits for is bounded by the export budget,
  not by this limit. `scrawl render` has no budget, so there a diagram that
  never finishes is waited for until the limit.
- An export gives all its diagrams three quarters of the write timeout
  together, or 45 seconds when there is none, counted from the start of the
  request, as the write timeout is: the diagrams left when it runs out stay
  code, with the note that they could not be rendered, so the page reaches the
  client before the server cuts the connection. The one being drawn when the
  budget runs out keeps drawing and is kept, so the next export of the note has
  it at once; otherwise a diagram slower than one budget would be code in every
  export and a killed worker would start cold again. A client that goes away
  stops the diagrams not started yet, even one waiting for the worker. Two
  exports that need the same diagram at once draw it once: the second waits for
  the first's answer, and that includes a drawing whose own client has left. If
  the first gave up waiting for the worker, the second draws it itself.
- A drawn diagram, or the engine's refusal, is kept by its source, so the next
  export of the note costs nothing. The cache holds up to 512 answers and 32MB,
  and drops the one used longest ago first; an answer over 32MB is not kept. A
  diagram killed at the limit is kept the same way, as an error that says it
  did not finish in time. Otherwise each export of the note would hold the only
  worker for two minutes again, and every other export would wait behind it.
- When scrawl stops, the pool kills a worker still drawing and waits until it
  is gone, so no worker outlives scrawl. The drawing runs under the pool's own
  context for this, not under the context of its client. It is the one
  background goroutine that is not under the worker context of
  [Lifecycle](#lifecycle): `Renderer.Close`, deferred in `main`, stops it, and
  `scrawl render` closes its own renderer the same way.
- An engine that crashes, as one does on a recursion deeper than its stack
  ([quirks](../quirks.md#mermaid-plantuml-and-katex)), cannot draw again. The
  worker answers that the engine failed on this diagram and exits, and the
  answer is kept like a refusal: the same source crashes the same way, and
  keeping it saves a new worker on each export. The browser still draws it.
- A large library takes hundreds of megabytes, and a WebAssembly memory never
  shrinks. So the worker exits after the answer that leaves its engine's memory
  above 256MB, saying so in that answer, and the pool stops a worker idle for
  two minutes. A new engine in the same process would hold 1.1GB instead of
  115MB ([quirks](../quirks.md#mermaid-plantuml-and-katex)). After each answer
  the worker gives the memory Go freed back to the system.
- `plantuml/engine.wasm` and `plantuml/library/` are committed, and
  `make plantuml` builds both again, which needs the network. javy does not
  build the same bytes twice, so nothing compares the wasm with its source;
  `TestTheBrowserTheServerAndTheLibraryAreOnePlantUML` checks that the server's
  engine is the version the browser has, and the library the commit it names.
  An upgrade bumps `@plantuml/core` in `web/package.json`, `@plantuml/mcp-js`
  in `plantuml/js/package.json`, and by hand the commit and the 20 sha256 sums
  in `plantuml/js/library.json`, then runs `make ui` and `make plantuml`. The
  icon sets [ADR 19](../adr/0019-plantuml-library-without-some-icon-sets.md)
  names stay out of that file.
- The library is committed compressed, unlike every other embedded file
  ([ADR 3](../adr/0003-gzip-assets-out-of-git.md)): raw it is some 29MB against
  4MB compressed, the raw bytes would sit in a `go install` binary, and it
  changes only with an upgrade.
- The library is served under `/static/<version>/plantuml/<file>`, as stored,
  compressed. Only the plain name of a file in it answers, so an include cannot
  name a path out of it, and the browser asks for nothing else: its loader
  takes a plain name only. The `<version>` there is the bundle's digest, since
  the address is relative to the chunk of the engine. The route ignores it and
  lets a browser keep the file a year, which is safe while a file of the
  library changes only with a change of the bundle: the test above ties the
  library to the engine's version, and a new engine is a new bundle.

## Lifecycle

- Every background goroutine runs under a worker context canceled the moment
  `srv.Run` returns, apart from a PlantUML drawing ([PlantUML](#plantuml)), and
  that cancel is called rather than deferred. `Web.Run` returns as soon as
  `ListenAndServe` fails while its context is still live, so a wait on a
  goroutine that only exits with that context would hang the process on a busy
  port.
