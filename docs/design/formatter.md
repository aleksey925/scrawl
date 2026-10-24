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
  `SCRAWL_FORMAT_WORKER` set, and never inside the server
  ([ADR 6](../adr/0006-prettier-in-worker-processes.md)). A process can be
  killed, so the deadline of a call is a real one and the next call gets a
  fresh worker. `main` asks `format.RunWorkerIfAsked` before anything else,
  because a worker must not parse flags or open a store.
- A note the formatter gave up on is stored as it was written, because the save
  is what the writer asked for, and the answer says so in `format_failed`. A
  write that formats is detached from its client: formatting takes seconds, and
  a tab closed meanwhile would otherwise cancel the commit that follows it.
