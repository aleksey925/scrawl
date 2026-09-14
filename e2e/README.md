# End to end tests

Playwright drives a real Chromium against a real `scrawl` binary: two
projects, desktop at 1440x900 and an iPhone 13 profile at 390x844 with
touch and a mobile user agent.

The suite drives the react app, not the server rendered pages.

`playwright.config.js` starts the binary itself. Four instances come up,
each against its own throwaway copy of the corpus made by
`support/serve.js`, so a run never touches the source tree:

- `127.0.0.1:8731` - normal mode, used by nearly every spec
- `127.0.0.1:8732` - `--read-only --history=on`, used by
  `readonly.spec.js` and by the read-only half of `history.spec.js`
- `127.0.0.1:8733` - `--upload-dir=attachments`, one upload test
- `127.0.0.1:8734` - `--history=on`, used by `history.spec.js`

All four run with authentication on, user `e2e`, password
`e2e-secret-pass`. Every instance passes `--history` explicitly: left to
the default a machine without git would silently serve without versions.

## Where the app answers

The app is mounted under `/app` while the server rendered pages still own
`/`, `/p/`, `/edit/`, `/history/` and `/search`. That prefix has one home,
`appBase` in `support/env.js`, and every url a spec visits is built by a
`routes` helper beside it:

```js
routes.doc('db/notes.md')   // /app/p/db/notes.md
routes.dir('db')            // /app/p/db/
routes.edit('db/notes.md')  // /app/edit/db/notes.md
routes.search('индексы')    // /app/search?q=...
```

No spec writes `/app` itself, so the day the app takes the old urls over,
setting `appBase` to `''` is the whole change. `SCRAWL_E2E_APP_BASE` sets
it for one run.

Two things are deliberately not built from `appBase`, because they do not
move with it: `routes.raw()`, which is a server route, and
`routes.contentHref()`, the `/p/` prefix the renderer writes into note
html and the app recognises on a click.

Signing in goes through the server rendered form. The app is behind the
same middleware as everything else, so an anonymous visitor of an app url
is handed `/login?from=<app url>` and comes back to where they were
going; the app's own login screen is what a reader sees after signing out.

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
| `SCRAWL_E2E_APP_BASE` | url prefix the app answers under | `/app` |
| `SCRAWL_E2E_FIXTURE` | corpus copied for each run | the private corpus, else `examples/data` |
| `SCRAWL_E2E_WORK` | where the copies and the server logs go | `$TMPDIR/scrawl-e2e` |
| `SCRAWL_E2E_PORT` | port of the normal instance | `8731` |
| `SCRAWL_E2E_PORT_RO` | port of the read-only instance | `8732` |
| `SCRAWL_E2E_PORT_SHARED` | port of the `--upload-dir` instance | `8733` |
| `SCRAWL_E2E_PORT_HISTORY` | port of the `--history=on` instance | `8734` |
| `SCRAWL_E2E_SHOTS` | where the step screenshots go | `e2e/screenshots` |

Server logs are the first place to look at a failure:
`$TMPDIR/scrawl-e2e/main.log`, `readonly.log`, `shared.log` and
`history.log`.

## Known gaps

A handful of specs are written out in full and marked `fixme`: they
describe behaviour the old frontend had and the app does not yet, so they
are skipped rather than deleted, and they start passing on their own once
the app catches up.

- the navigation drawer and the outline sheet on a phone never stay open.
  `AppLayout` closes them from an effect that lists the disclosure
  handlers among its dependencies, and mantine builds those fresh on
  every render, so the effect runs after each one.
- the drawer has no swipe to close.
- the top bar controls are drawn at their desktop size on a phone, under
  the touch minimum, and so is Restore on the history page.
- the editor's source pane collapses to a sliver on a phone: the wrapper
  around it has no flex-grow, and only the split layout gives it a width.
- a fragment whose case differs from the slug the renderer made no longer
  resolves, so `[x](#Индексы)` does not reach `<h2 id="индексы">`.
- the palette does not mark the search term inside a hit.
- there is no shortcut cheat sheet.

## Notes

- The suite runs with one worker. Both projects drive the same tree on
  disk, and a second worker would rename files under a running test.
- Specs that write create their own scratch documents under an
  `e2e-*` folder and remove them again, so the corpus copy stays as it
  was copied.
- CI runs the whole suite on `examples/data` and keeps the HTML report of
  a failed run as a build artifact. A test gets one retry there and none
  locally.
