# End to end tests

Playwright drives a real Chromium against a real `scrawl` binary, in two
profiles: desktop at 1440x900, and an iPhone 13 at 390x844 with touch and
a mobile user agent. They are playwright's own "projects", which is an
unrelated word to scrawl's - everything below means scrawl's.

The suite drives the react app. The one page the server renders itself is
the sign-in form.

`playwright.config.js` starts the binary itself. Five instances come up,
each against its own throwaway copy of the corpus made by
`support/serve.js`, so a run never touches the source tree:

- `127.0.0.1:8731` - normal mode, used by nearly every spec
- `127.0.0.1:8732` - `--read-only --history=on`, used by
  `readonly.spec.js` and by the read-only half of `history.spec.js`
- `127.0.0.1:8733` - `--upload-dir=attachments`, one upload test
- `127.0.0.1:8734` - `--history=on`, used by `history.spec.js`
- `127.0.0.1:8735` - the only one started from a `--config` file, with
  four projects, used by `projects.spec.js` and `sync.spec.js`

All five run with authentication on, user `e2e`, password
`e2e-secret-pass`. Every instance passes `--history` explicitly: left to
the default a machine without git would silently serve without versions.

### The multi-project instance

Its four projects are what the boundary between them is tested against,
and two of them are git clones of bare repositories the launcher seeds
beside the work directory, so the remote mode runs with no network:

- `notes` - the fixture copy, like every other instance
- `team` - a second local folder with a tree of its own, so a spec about
  two projects cannot be fooled by a document both of them hold
- `wiki` - a clone with `pull: 2s`, for the ticker
- `hooked` - a clone with `pull: 0` and a webhook secret, so a note that
  appears there appeared because a delivery arrived and for no other
  reason

`support/git.js` is what a spec uses to move the origin: `pushToOrigin`
is a second writer, and `breakOrigin` moves the repository aside rather
than changing the project's configuration, which is what a remote going
away actually looks like.

## Where the app answers

Every project owns one contiguous subtree, `/p/<name>/`, and the handful
of routes that read no store answer at the root. `routesFor(project)` in
`support/env.js` builds both halves and no spec writes a url by hand:

```js
routes.doc('db/notes.md')   // /p/notes/doc/db/notes.md
routes.dir('db')            // /p/notes/doc/db/
routes.edit('db/notes.md')  // /p/notes/edit/db/notes.md
routes.search('индексы')    // /p/notes/search?q=...
routes.api('/me')           // /p/notes/api/me
routes.hook()               // /p/notes/hook
routes.login()              // /login, which is global
```

`routes` is the default project's set. An instance carries its own under
`inst.url`, and one per project under `inst.projects[name]`, both
absolute, for a spec that drives an instance other than the one
playwright's `baseURL` points at.

`routes.contentHref()` is the href the renderer writes into note html.
It carries the project prefix, because the browser would fetch it
directly; the app recognises it and routes the click itself.

Signing in goes through the server rendered form, which is the only login
screen there is. An anonymous visitor of any app url is handed
`/login?from=<url>` and comes back to where they were going, and signing
out is a full page load to the same form.

## Selectors and strings

Every control carries a `data-testid` and its state sits on a data
attribute beside it (`data-current`, `data-dirty`, `data-state`,
`data-open`, `data-active`, `data-selected`, `data-kind`, `data-done`).
They spell out `"true"` and `"false"`, so a spec asserts the negative
without `:not()`. Nothing inside a rendered note is addressed by id:
a heading becomes an element id, and `pages.spec.js` keeps a note that
claims the names of the chrome to prove it stays out of the way.

Asserted interface strings live in `support/text.js`, so a wording change
is one edit there.

## Fixtures

The suite runs against two trees and passes on both:

- `~/CodeProjects/knowledge-base`, the private corpus this app was
  written for, used whenever it is there
- `examples/data`, the fixture in this repository, used otherwise, which
  is what a fresh clone and CI get

No spec names a document. `support/docs.js` maps a role - the document
with an outline, the folder without an index, the word that is found in
more than one page - onto a path in whichever tree is in use, and the
specs ask for roles. A new spec that needs something new adds the role
there for both fixtures instead of hard coding another path.

`SCRAWL_E2E_FIXTURE` picks a different tree. Anything but `examples/data`
is taken to be the private corpus or a copy of it, so pointing it at an
unrelated notes tree will fail on the first document a spec asks for.

## The editor

The editor is codemirror, so there is no field with a value to set or
read. `support/helpers.js` carries the two ways around that:

- `setSource(page, text)` selects everything and inserts the text as one
  input event, which goes in byte for byte. Typing it would run through
  the markdown keymap, which continues lists and indents blocks.
- `sourceText(page)` reads the rendered lines back. Codemirror only
  renders what is on screen, so it answers for the scratch documents the
  specs write and not for a long one; anything about bytes is asserted
  against the file on disk.

## Running

`node_modules` is deliberately not part of the repository:

```
make build
export PATH="$HOME/.local/share/mise/shims:$PATH"
cd e2e
npm install
npx playwright install chromium
npx playwright test
```

With Playwright already installed somewhere else, point `NODE_PATH` at it
instead of installing again:

```
NODE_PATH=/path/to/playwright/node_modules \
  /path/to/playwright/node_modules/.bin/playwright test
```

Add `--project=desktop` or `--project=mobile` to run one profile, and a
file name or `-g <pattern>` to run part of the suite. To run against
`examples/data` while the private corpus is on the machine:

```
SCRAWL_E2E_FIXTURE=../examples/data npx playwright test
```

## Knobs

| variable | meaning | default |
|---|---|---|
| `SCRAWL_E2E_FIXTURE` | corpus copied for each run | the private corpus, else `examples/data` |
| `SCRAWL_E2E_WORK` | where the copies, the config files and the server logs go | `$TMPDIR/scrawl-e2e` |
| `SCRAWL_E2E_PORT` | port of the normal instance | `8731` |
| `SCRAWL_E2E_PORT_RO` | port of the read-only instance | `8732` |
| `SCRAWL_E2E_PORT_SHARED` | port of the `--upload-dir` instance | `8733` |
| `SCRAWL_E2E_PORT_HISTORY` | port of the `--history=on` instance | `8734` |
| `SCRAWL_E2E_PORT_MULTI` | port of the multi-project instance | `8735` |
| `SCRAWL_E2E_SHOTS` | where the step screenshots go | `e2e/screenshots` |

Server logs are the first place to look at a failure:
`$TMPDIR/scrawl-e2e/main.log`, `readonly.log`, `shared.log`,
`history.log` and `multi.log`. The generated config of the multi
instance is `$TMPDIR/scrawl-e2e/multi.yml`, which is worth reading when a
project starts in a state nobody expected.

## Notes

- The suite runs with one worker. Both profiles drive the same trees on
  disk, and a second worker would rename files under a running test.
- Specs that write create their own scratch documents under an
  `e2e-*` folder and remove them again, so the corpus copy stays as it
  was copied. The ones that break a git origin restore it in an
  `afterEach` and wait for the project to be in step again, so the next
  spec never inherits a broken remote.
- CI runs the whole suite on `examples/data` and keeps the HTML report of
  a failed run as a build artifact. A test gets one retry there and none
  locally.
