# Formatter

Prettier inside the binary and in the browser.

- The formatter is prettier itself, run inside the binary: `format` embeds one
  wasm module holding prettier and QuickJS, built by javy, and wazero executes
  it with no cgo ([ADR 4](../adr/0004-prettier-in-wasm.md)). The module is
  committed for the reason the bundle is, `make formatter` rebuilds it, and
  javy's output is not byte-reproducible, so its guard is a test on what it
  formats and not a diff in CI. The version is the one `mise.toml` pins and the
  plugins are the ones the command line loads, so a note saved here does not
  come back changed from `prettier --write`.
- Prose is wrapped at 79 columns, `proseWrap: always` with `printWidth: 79`, in
  both copies: a note reads the same in any editor and a diff shows the lines a
  change touched, not a paragraph on one line. Short lines of one paragraph are
  joined up to the width, which markdown mostly renders the same. The one line
  break that counts is the one after the marker of an alert, `> [!NOTE]`:
  GitHub and `render` take the marker only alone on its line, and joined it is
  a plain quote. So each copy adds a small prettier plugin, in
  `format/js/main.js` and `web/src/editor/alertMarkers.ts`, that keeps that
  break in the first paragraph of a top-level quote whose first line is a
  marker of the five kinds. A marker already joined to its text is left joined.
  A word, a link or code is never split, so such a line stays longer
  ([ADR 21](../adr/0021-notes-wrapped-at-79-columns.md)).
- Two copies of prettier, and each write goes through exactly one
  ([ADR 5](../adr/0005-format-in-browser-first.md)). The editor formats in the
  browser, on the button and before a save, and says so with `formatted` in the
  request. Every other writer - an API client, a restore, an editor whose
  prettier would not load - leaves that out and the server formats, in
  `formatOnSave`. A test holds the two versions together. It is on unless a
  space turns it off, and only `.md` is formatted. A change on disk and a pull
  are not writes of ours and stay as they came: a commit made to format what
  the remote sent would be a reason to diverge.
- Prettier runs in worker processes, copies of this binary started with
  `SCRAWL_FORMAT_WORKER` set, and never inside the server. The pool is
  `workerpool`, which PlantUML's engine on the server runs in as well
  ([ADR 6](../adr/0006-prettier-in-worker-processes.md)). A process can be
  killed, so the deadline of a call is a real one and the next call gets a
  fresh worker. `main` asks `format.RunWorkerIfAsked` and
  `plantuml.RunWorkerIfAsked` before anything else, because a worker must not
  parse flags or open a store.
- The tests of `format`, `plantuml` and the command line open a compilation
  cache on disk, in `scrawl/wasm` of the user's cache directory, not the shared
  temp directory where another user could plant compiled code, with
  `workerpool.UseCompilationCache` before they ask for a worker, so every
  worker a test starts reads the compiled module instead of compiling it again:
  under `-race` wazero compiles PlantUML's engine in 3.4 seconds, not 0.3. The
  cache stays between runs, as that is where the time is saved; wazero keys it
  by the module and its own version. The server has no such cache, as its
  worker compiles the module once in its life, and the browser suite runs that
  path. Of the tests of `plantuml`, the ones that draw run in parallel, but
  each engine is a process of some 450MB under `-race`, so the tests that start
  their own renderer, or an engine in the test process, stay in order and the
  drawings share one worker. The one exception draws every example with a
  renderer each, so the note of icon sets, which takes over half a minute to
  draw ([quirks](../quirks.md#mermaid-plantuml-and-katex)), holds none of the
  others up: six beside the shared worker, seven processes, as many as ran
  before, some 3.4GB at the peak.
- A note the formatter gave up on is stored as it was written, because the save
  is what the writer asked for, and the answer says so in `format_failed`. A
  write that formats is detached from its client: formatting takes seconds, and
  a tab closed meanwhile would otherwise cancel the commit that follows it. A
  shutdown still cancels it. [Server](server.md#lifecycle)
