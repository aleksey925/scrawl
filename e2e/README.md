# End to end tests

Playwright drives a real Chromium against a real `mdserver` binary: two
projects, desktop at 1440x900 and an iPhone 13 profile at 390x844 with
touch and a mobile user agent.

`playwright.config.js` starts the binary itself. Three instances come up,
each against its own throwaway copy of the corpus made by
`support/serve.js`, so a run never touches the source tree:

- `127.0.0.1:8731` - normal mode, used by nearly every spec
- `127.0.0.1:8732` - `--read-only`, used by `readonly.spec.js`
- `127.0.0.1:8733` - `--upload-dir=attachments`, one upload test

All three run with authentication on, user `e2e`, password
`e2e-secret-pass`.

## Fixtures

The suite runs against two trees and passes on both:

- `~/CodeProjects/knowledge-base`, the private corpus this app was
  written for, used whenever it is there
- `testdata/kb`, the fixture in this repository, used otherwise, which
  is what a fresh clone and CI get

No spec names a document. `support/docs.js` maps a role - the document
with an outline, the folder without an index, the word that is found in
more than one page - onto a path in whichever tree is in use, and the
specs ask for roles. A new spec that needs something new adds the role
there for both fixtures instead of hard coding another path.

`MDSERVER_E2E_FIXTURE` picks a different tree. Anything but `testdata/kb`
is taken to be the private corpus or a copy of it, so pointing it at an
unrelated knowledge base will fail on the first document a spec asks for.

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
`testdata/kb` while the private corpus is on the machine:

```
MDSERVER_E2E_FIXTURE=../testdata/kb npx playwright test
```

## Knobs

| variable | meaning | default |
|---|---|---|
| `MDSERVER_E2E_FIXTURE` | corpus copied for each run | the private corpus, else `testdata/kb` |
| `MDSERVER_E2E_WORK` | where the copies and the server logs go | `$TMPDIR/mdserver-e2e` |
| `MDSERVER_E2E_PORT` | port of the normal instance | `8731` |
| `MDSERVER_E2E_PORT_RO` | port of the read-only instance | `8732` |
| `MDSERVER_E2E_PORT_SHARED` | port of the `--upload-dir` instance | `8733` |
| `MDSERVER_E2E_SHOTS` | where the step screenshots go | `e2e/screenshots` |

Server logs are the first place to look at a failure:
`$TMPDIR/mdserver-e2e/main.log`, `readonly.log` and `shared.log`.

## Notes

- The suite runs with one worker. Both projects drive the same tree on
  disk, and a second worker would rename files under a running test.
- Specs that write create their own scratch documents under an
  `e2e-*` folder and remove them again, so the corpus copy stays as it
  was copied.
- CI runs the whole suite on `testdata/kb` and keeps the HTML report of
  a failed run as a build artifact. A test gets one retry there and none
  locally.
