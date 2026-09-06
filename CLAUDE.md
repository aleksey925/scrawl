# scrawl

Single Go binary that serves a directory of markdown files as a
knowledge base web app with in-browser editing. Runs in Docker, no
external services, all state on disk.

## Layout

```
main.go                config (go-flags + env), wiring, graceful shutdown
store/                 safe filesystem access, tree, CRUD, watcher
render/                markdown -> HTML, link rewrite, TOC, highlighting
search/                in-memory full-text index
auth/                  users, sessions, middleware, CSRF, rate limit
server/                HTTP server, handlers, page cache
server/templates/      html/template pages, parsed as one set
server/assets/         css and js, embedded and served under /static
server/assets/vendor/  KaTeX and mermaid, checked in, never from a CDN
e2e/                   playwright suite against a real binary
testdata/notes/        fixture knowledge base: tests, `make run`, and the
                       browser suite when the private corpus is absent
```

## Rules

- Go 1.25, module `github.com/aleksey925/scrawl`.
- Follow umputun's style: `go-flags` with `env` tags, `go-pkgz/lgr` for
  logs, `go-pkgz/rest` middlewares, `routegroup` for routing, testify
  for tests, `moq` for mocks. Packages are flat at the repository root,
  there is no `app/` directory.
- Every filesystem operation goes through `store`, which is built on
  `os.Root`. Never join paths against the OS root anywhere else - path
  traversal has to be impossible by construction.
- Writes are atomic: temp file in the same directory, then rename.
- All rendered HTML is sanitized. Raw HTML in markdown is allowed, but
  only through the bluemonday policy in `render`, which starts from
  `NewPolicy` because a policy can only ever be widened afterwards.
- `/raw/` never serves an executable document. The content type comes
  from an allowlist keyed on the extension, anything outside it is a
  download, and the route carries its own `default-src 'none'; sandbox`
  policy on top of `nosniff`.
- Rendering is superlinear on some inputs, so every render is bounded by
  a size cap and a deadline, and the whole server by a small throttle.
- Uploads land in a folder next to the document and named after it
  (`python/notes.md` -> `python/notes/`), which is what the corpus looks
  like. `--upload-dir` replaces that with one shared directory.
- The sidebar tree indexes documents: markdown files and the directories
  leading to them. Other files stay reachable through the directory page
  and `/raw/`.
- No npm build step and no CDN at runtime. Templates, CSS, JS and fonts
  are embedded with `//go:embed`.
- Frontend is server-rendered HTML plus vanilla JS enhancement. Design
  tokens live in one CSS file; light and dark themes come from custom
  properties.
- Content paths are relative to the root, slash-separated, without a
  leading slash. Markdown URLs keep the `.md` suffix, because a file
  and a directory can share a name (`foo.md` next to `foo/`).
- `.md` is the only document extension, everywhere: the link rewriter,
  the tree, the search index, the editor and the create dialog all ask
  the same question. A `.markdown` file is an attachment like any
  other and is read through `/raw/`.
- Write endpoints require auth and CSRF, and are refused in read-only
  mode.

## Commands

```
make build   build the binary
make test    tests with race detector
make lint    golangci-lint
make run     run against ./testdata/notes with auth disabled
```
