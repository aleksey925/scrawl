# scrawl

A web app for a folder of markdown files. Read and edit your notes from
a browser, on a laptop or a phone. One static binary, no database: the
files on disk are the only state.

- full text search, with a command palette on `Ctrl`/`Cmd` + `K`
- an editor with live preview, on desktop and on mobile
- create, rename and delete pages, paste images straight into the editor
- a login page, users configured through the environment
- light and dark themes

![Reading a page](img/reading.png)

![The editor with live preview](img/editor.png)

![The same page on a phone](img/mobile.png)

## Try it

```
docker compose up
```

Open http://localhost:8080 and sign in as `admin` / `admin`. It serves
the sample notes from `examples/data`, so anything you edit changes
those files.

## Install it

Docker is the usual way to run it:

```
docker run -d --name scrawl \
  -p 8080:8080 \
  -v /path/to/notes:/notes \
  -v scrawl-data:/data \
  -e AUTH_USERS='alex:my-password' \
  ghcr.io/aleksey925/scrawl:master
```

A plain password works and the server warns about it on startup. For
anything reachable from outside, use a hash instead:

```
printf 'my-password' | docker run --rm -i ghcr.io/aleksey925/scrawl:master --gen-hash
```

[examples/docker-compose.yml](examples/docker-compose.yml) is a fuller
deployment example. One thing there is worth knowing in advance: the
image runs as uid 1001, and if your notes folder belongs to a different
user, reading works and every save fails. The startup log says so, and
the `user:` line fixes it.

Without docker, install the binary from [Homebrew](https://brew.sh):

```
brew install aleksey925/apps/scrawl
```

or unpack the latest [release](https://github.com/aleksey925/scrawl/releases)
archive into `~/.local/bin`:

```
VERSION=$(curl -sL -o /dev/null -w '%{url_effective}' https://github.com/aleksey925/scrawl/releases/latest | sed 's/.*\/v//')
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
curl -#L "https://github.com/aleksey925/scrawl/releases/download/v${VERSION}/scrawl_${VERSION}_${OS}_${ARCH}.tar.gz" | tar xz -C ~/.local/bin scrawl
```

or build it yourself with `go install github.com/aleksey925/scrawl@latest`.
A binary defaults to `/notes` and `:8080`, so point it at your own folder:

```
scrawl --root ~/notes --auth.users 'alex:my-password'
```

## Configuration

Environment variables, each also available as a flag. Run
`scrawl --help` for the rest, including the HTTP timeouts.

| variable           | default             | meaning                                                   |
| ------------------ | ------------------- | --------------------------------------------------------- |
| `ROOT`             | `/notes`            | directory to serve                                        |
| `LISTEN`           | `:8080`             | address to listen on                                      |
| `TITLE`            | `Notes`             | site title in the interface                               |
| `AUTH_USERS`       |                     | `user:hashOrPassword`, comma separated                    |
| `AUTH_SECRET`      |                     | cookie signing key, generated if empty                    |
| `AUTH_SECRET_FILE` | `/data/session.key` | where a generated key is kept                             |
| `AUTH_TTL`         | `720h`              | how long a session lasts                                  |
| `AUTH_SECURE`      | `auto`              | `Secure` flag of the session cookie                       |
| `AUTH_DISABLED`    | `false`             | serve without authentication                              |
| `READ_ONLY`        | `false`             | refuse every write                                        |
| `EXCLUDE`          |                     | extra ignore globs, comma separated                       |
| `MAX_UPLOAD`       | `20M`               | upload size cap                                           |
| `UPLOAD_DIR`       |                     | one shared folder for uploads                             |
| `WATCH`            | `auto`              | `poll` when the root is a network share                   |
| `RESCAN`           | `60s`               | periodic rescan, negative disables it unless `WATCH=poll` |
| `TRUSTED_PROXY`    | `false`             | trust `X-Forwarded-For` and `-Proto`                      |
| `TZ`               | `UTC`               | timezone                                                  |
| `DEBUG`            | `false`             | debug logging                                             |

Dot directories, `node_modules` and `__pycache__` are ignored, so notes
kept in git do not expose `.git`.

Behind a proxy that terminates TLS, set `TRUSTED_PROXY=true` and
`AUTH_SECURE=always`. The proxy must overwrite `X-Forwarded-For`,
otherwise a client can pick its own login rate limit bucket.

## Markdown

Pages render the way GitHub renders them: tables, task lists, footnotes,
alerts, emoji shortcodes, math, mermaid diagrams, `<details>` sections
and syntax highlighting.

````
> [!WARNING]
> This is an alert.

A footnote reference[^1] and a diagram:

```mermaid
graph LR; A --> B;
```

[^1]: The footnote text.
````

Relative links between pages, in-page anchors and images from sibling
folders all keep working, and headings get anchors that handle Cyrillic.
Pasted images land in a folder next to the document and named after it,
so `python/notes.md` gets `python/notes/`. `UPLOAD_DIR` collects them in
one folder instead.

## Editing

- a save writes a temporary file and renames it into place, so a crash
  cannot leave half a document behind
- trailing whitespace is never trimmed, in markdown it can be meaningful
- if the file changed on disk since the editor opened it, the save is
  refused and you are shown both versions
- nothing outside the root is reachable and symbolic links are ignored

## Development

The toolchain comes from `mise.toml`, so
[mise](https://mise.jdx.dev/getting-started.html) is the only thing to
install by hand:

```
mise install
make deps
```

```
make build      build the binary into dist/
make run        run against ./examples/data without authentication
make test       tests
make race       tests with the race detector
make cover      race tests plus a coverage summary
make lint       every hook: formatting, go vet, golangci-lint
make e2e        the browser suite
make docker     build the image
```

`make help` lists the rest. Browser tests live in [e2e/](e2e/), see
[e2e/README.md](e2e/README.md).
