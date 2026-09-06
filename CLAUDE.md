# mdserver

Single Go binary that serves a directory of markdown files as a
knowledge base web app with in-browser editing. Runs in Docker, no
external services, all state on disk.

## Layout

```
app/main.go        config (go-flags + env), wiring, graceful shutdown
app/store/         safe filesystem access, tree, CRUD, watcher
app/render/        markdown -> HTML, link rewrite, TOC, highlighting
app/search/        in-memory full-text index
app/auth/          users, sessions, middleware, CSRF, rate limit
app/rest/          HTTP server, handlers, templates, static assets
```

## Rules

- Go 1.25, module `github.com/aleksey925/mdserver`.
- Follow umputun's style: `app/` packages, `go-flags` with `env` tags,
  `go-pkgz/lgr` for logs, `go-pkgz/rest` middlewares, `routegroup` for
  routing, testify for tests, `moq` for mocks.
- Every filesystem operation goes through `store`, which is built on
  `os.Root`. Never join paths against the OS root anywhere else - path
  traversal has to be impossible by construction.
- Writes are atomic: temp file in the same directory, then rename.
- All rendered HTML is sanitized. Raw HTML in markdown is allowed, but
  only through the bluemonday policy in `render`.
- No npm build step and no CDN at runtime. Templates, CSS, JS and fonts
  are embedded with `//go:embed`.
- Frontend is server-rendered HTML plus vanilla JS enhancement. Design
  tokens live in one CSS file; light and dark themes come from custom
  properties.
- Content paths are relative to the root, slash-separated, without a
  leading slash. Markdown URLs keep the `.md` suffix, because a file
  and a directory can share a name (`foo.md` next to `foo/`).
- Write endpoints require auth and CSRF, and are refused in read-only
  mode.

## Commands

```
make build   build the binary
make test    tests with race detector
make lint    golangci-lint
make run     run against ./testdata with auth disabled
```
