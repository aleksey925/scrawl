# Several note projects: local folders and git remotes

## Problem

Today scrawl serves exactly one directory. `--root` is one string
(`main.go:37`), `run` builds one store, one index, one history service and
one `server.Web` (`main.go:166-249`), and the URL space is flat: `/p/`,
`/raw/`, `/edit/`, `/history/`, `/search`, `/api/...`.

Two things are wanted:

1. A project may be a git repository instead of a local folder. scrawl
   clones it, serves it, and pushes what the reader edits back.
2. Several projects at once, in any mix of local folders and remotes.

The constraint that outranks everything else: the result must stay simple
and transparent. The design below adds exactly two new concepts, a
**project** and a **remote**, and reuses the existing machinery for
everything else. Where a feature would need more than that, it is cut and
named in "Not in scope".

There is no backwards compatibility. Every project is always addressed by
an explicit URL prefix, including when there is exactly one project. Old
URLs stop working. "Migration" below says what that costs; "Key
decisions" says why it is cheaper than the alternative.

## Context

### store is already per-instance

`store.Store` holds its own root and its own `os.Root` handle
(`store/store.go:74-120`). There is no package state beyond immutable
tables (`store/store.go:50`, `store/upload.go:29`). `Dir()`
(`store/store.go:147`) and `ReadOnly()` (`store/store.go:150`) already
answer per instance, and `Config.ReadOnly` (`store/store.go:65`) already
makes one store refuse writes. `Config.Root` is an explicit directory and
nothing derives it (`store/store.go:62-71`). The tests build a store per
test (`store/store_test.go:78-89`), so N stores need no change at all in
this package.

The watcher is per store too (`store/watch.go`), and it never descends
into an ignored directory: `tracker.rel` refuses an excluded path
(`store/watch.go:150-161`) and `addTree` skips it (`store/watch.go:411`).
A `.git` directory is a dot-entry, so it is invisible to the store
(`store/store.go:664`) and no inotify watch is placed inside it. A clone
can sit under a store without its internals ever reaching the app.

`Watch` puts its watches and its baseline snapshot in place before it
returns (`store/watch.go:94-98`). Anything that changed the worktree
before the call is therefore part of the baseline and produces no event.
That fact decides the startup order in section 5.

### history already is git, and already adopts a repository

`history` shells out to the git binary; nothing is vendored
(`history/history.go:1-25`, `go.mod`). `New` resolves git, canonicalizes
the root, then `open` either adopts a repository rooted exactly at the
notes root, initializes one, or refuses a root that sits inside somebody
else's repository with `ErrInsideRepo` (`history/history.go:259-280`).
`checkGitDir` refuses a `.git` that is a gitfile pointing elsewhere
(`history/history.go:285-302`). `Config.Root` is mandatory and explicit,
exactly like the store's (`history/history.go:84-91`).

An adopted repository is neutered: `disableFilters` appends `* -filter`
to `.git/info/attributes` (`history/history.go:192-216`), and every call
carries `core.hooksPath=/dev/null`, `core.fsmonitor=`,
`commit.gpgSign=false` and an exact `safe.directory`
(`history/git.go:70-94`). The child environment strips every `GIT_*`
variable the host set and pins `GIT_CONFIG_GLOBAL=/dev/null`,
`GIT_CONFIG_SYSTEM=/dev/null` and `GIT_TERMINAL_PROMPT=0`
(`history/git.go:99-115`). That last one matters for a remote: git will
never stop and ask for a password, it fails instead.

Three details shape the remote design below.

`New` opens the root before it can run anything: it calls `canonical`,
then `os.OpenRoot`, and only then `open` (`history/history.go:114-145`).
Every git call goes through `Service.run`, which is a method and uses
`s.root` as `cmd.Dir` and `s.env()` for the child
(`history/git.go:36-66`). So a clone, which happens when there is no
directory yet and therefore no service, cannot use either.

`gitError` prints the arguments of the failing command, but only
`c.args`, never `baseArgs` (`history/git.go:63`, `:138-150`). A secret
placed in `baseArgs` stays out of the message; one placed in `c.args`
does not.

`run` builds the command with `exec.CommandContext` and no shell
(`history/git.go:48`). Every argument is a literal this package wrote.
Anything that reaches git as a shell string instead is a different kind
of input, which is what section 6 turns into a decision about ssh.

`Record` holds one mutex across the store mutation and the commit
(`history/write.go:45-73`), which is the invariant CLAUDE.md names. A
failed commit is fatal only for a strict caller, which is an API token;
otherwise the paths go into `pending`, `degraded` is set, and the next
successful commit folds them in (`history/write.go:107-117`,
`history/history.go:248`). `Reconcile` is the baseline import and the
recovery for anything changed outside the app
(`history/write.go:79-103`), driven from the watcher on a 2s debounce
(`main.go:356-394`).

That state machine has one property the remote design has to respect:
`commitLocked` returns `nil` when nothing is staged
(`history/write.go:121-126`), and both `Record` and `Reconcile` then
`clear(s.pending)` and set `degraded` to false
(`history/write.go:68-71`, `:99-102`). A success with nothing to commit
therefore clears the degraded flag.

Staging is already exact. `stage` passes the path list to
`git add -A --pathspec-from-file=- --pathspec-file-nul`
(`history/write.go:148-157`), so the worktree as a whole is never staged
and argv limits never apply. What it does not do is override ignore
rules: the package documents that a `.gitignore` among the notes
outranks anything scrawl writes (`history/history.go:11-16`). That is
the gap section 5 closes for a remote, and it is one flag wide.

`--history=auto|on|off` is read in `newHistory` (`main.go:283-300`):
`auto` degrades silently, `on` makes the same conditions fatal.

`versioned` (`history/history.go:319-322`) is consulted only on the write
side: `recordPaths`, `mutatedPaths` and `reconcilePaths`
(`history/write.go:211`, `:231`, `:262`). The read side has its own
guard in the server, `isMarkdown(p) && wb.Store.Visible(p)`
(`server/history.go:74`). Widening the versioned extension set therefore
widens what is committed and nothing else.

### server assumes one store, and builds URLs from literals

`server.Web` has singular fields (`server/server.go:129-142`): `Store`,
`Renderer`, `Index`, `History`, plus one `cache *pageCache`. `History` is
already an interface (`server/history.go:20-29`) so the handlers can be
driven without git. `Config` (`server/server.go:111-126`) carries no root
at all: the root is implicit in `Store`.

`main` imports `server` (`main.go:28`), so nothing in `server` can ever
refer to a type declared in `main`.

Every route is registered once, flat (`server/server.go:243-292`). The
page cache is keyed by content path plus document revision
(`server/cache.go:18-42`) and bounded at 256 entries / 64MB
(`server/server.go:61-62`); `Invalidate` drops a path
(`server/server.go:203`).

`NotFoundHandler` is always set on the root bundle, whichever bundle
registers it (`vendor/github.com/go-pkgz/routegroup/group.go:196-203`),
and scrawl's serves the shell with the one constant base
(`server/shell.go:178-180`, `:213-219`). There is exactly one 404
handler for the whole server.

The URL builders are package functions with the prefixes written in
(`server/page.go:187-224`): `contentURL`, `searchURL`, `dirURL`,
`editURL`, `historyURL`, `encodePath`. They are registered in the
template funcMap (`server/server.go:418-428`), but no template uses them
any more: `server/templates/` holds only `login.html`. That funcMap block
is dead and can go.

There is a seventh place that spells a page URL out, and it is outside
that range: `breadcrumbs` builds a directory URL as
`"/p/" + encodePath(prefix) + "/"` by hand (`server/page.go:180`)
instead of calling `dirURL`. It feeds `/api/nav` (`server/spa.go:259`),
so the client hands it to `<Link>`. Missing it would leave the one
builder that still says `/p/` after the rename, and React Router would
turn its output into `/p/<project>/p/...`.

`render` already takes the prefixes as options
(`render/render.go:24-25`, `41-51`, `63-71`), the link transformer holds
them (`render/link.go:21-25`, `82-114`), and `main` never sets them
(`main.go:235`). This is the natural hook for a per-project prefix and it
needs no new code in `render`.

`/api/me` already owns the current store's modes and the current history
state (`server/spa.go:265-278`). Every mutating JSON response already
carries `history_degraded` through `withHistory`
(`server/history.go:266-272`, `server/api.go:184`, `:235`, `:284`,
`:362`, `server/history.go:226`). The one exception is delete, which
answers `204 No Content` and carries nothing (`server/api.go:257`).

### the frontend is already mounted under a configurable base

The task brief is stale here: the React app is not at `/app`, and the
server-rendered `/p/` pages are gone. The app owns the whole origin and
`/p/` is a client route whose HTML is the shell (`server/shell.go:33`,
`189-211`). The shell hands the base to the client as a data attribute
(`server/shell.go:121`), the client reads it (`web/src/mount.ts:15-18`)
and gives it to the router as the basename (`web/src/routes.tsx:28`).
So a prefix under which the whole app answers already works.

`mountBase()` returns whatever the server put in the attribute, verbatim,
with `/` as the fallback (`web/src/mount.ts:15-18`). There is no
normalization of a trailing slash anywhere, which is why section 9 has to
fix the contract before anything concatenates onto it.

Because the router has a basename, there are two kinds of URL in the
client and they must not be mixed:

- **Router-relative.** Anything handed to `<Link to>` or `navigate()`.
  React Router prepends the basename itself, so these must carry no
  prefix. `doc.edit_url` comes from the server (`server/spa.go:235`) and
  goes straight into a `<Link>` (`web/src/components/DocumentBody.tsx:26`),
  so server-produced navigation URLs are router-relative too. Prefixing
  them server-side would produce `/p/notes/p/notes/...`.
- **Physical.** Anything the browser fetches directly: `fetch` in the API
  client, the `href`/`src` the renderer writes into a note, the
  `/raw/` redirect, `/static/`. These need the mount prefix.

Today the basename is `/`, so mixing the two is invisible. Under this
design it never is: the prefix is non-empty in every run and every test,
so a mistake here fails immediately instead of waiting for somebody's
second project.

What does not follow the base:

- the API client, which writes absolute `/api/...` literals
  (`web/src/api/client.ts:128-159`, `165-171`, `196-272`).
- the in-note link interception. `internalTarget` matches on the literal
  `/p/` and returns `url.pathname`, a physical path, which
  `useDocumentControls` hands to `navigate` (`web/src/reader/links.ts:3`,
  `22-35`, `web/src/reader/useDocumentControls.ts:98`). Under a basename
  that is a physical path given to a router-relative call.
- the PWA manifest scope (`server/server.go:337-338`).

Three more places mix the two kinds of URL, and each one is invisible
while the basename is `/`. Under a prefix they are a silent client 404
or a URL with the wrong shape:

- **`/login`.** `AccountMenu` navigates to `/login` twice, once after
  signing out (`web/src/shell/AccountMenu.tsx:18-20`) and once from the
  "Sign in" item shown to a reader who is not signed in
  (`AccountMenu.tsx:62`), `AppLayout`'s unauthorized handler navigates to
  `/login?from=...` built from the router-relative `location.pathname`
  (`AppLayout.tsx:73-78`), and the editor's session expiry dialog does
  the same (`EditorScreen.tsx:342-345`). All four go
  through the router, so under a basename they produce
  `/p/<project>/login` and a `from` with no project in it, while the
  real login handler is global (`server/server.go:254`). There is also a
  second login screen: `routes.tsx:21-25` registers an SPA `LoginPage`
  that the server route never serves, so it is reachable only by a
  client-side `navigate`.
- **attachments in a directory listing.** `contentURL` returns
  `/raw/<path>` for anything that is not markdown
  (`server/page.go:187-194`), directory entries carry it
  (`server/page.go:72-87`), and `DirectoryView` renders every entry as a
  `<Link>` (`web/src/components/DirectoryView.tsx:38-50`). The client's
  own `documentUrl` has the same `/raw/` fallback
  (`web/src/paths.ts:44-46`).
- **an API handoff.** A 409 carries the route to ask instead
  (`server/spa.go:145-148`, `:171`, `:324-326`) and `AsyncContent` turns
  it into `<Navigate to>` (`web/src/components/AsyncContent.tsx:18-22`).
  For `kind: "attachment"` that target is a `/raw/` path.

`web/src/paths.ts:44-58` is router-relative and stays that way; only the
literal segment it builds changes, `/p/` to `/doc/`. Two more places
spell that same segment out: the route table registers `p/*`
(`web/src/routes.tsx:14`) and `contentPathOf` matches
`^/(?:p|edit|history)/` (`web/src/shell/naming.ts:21-24`). Both are
router-relative, and both still have to rename the word, otherwise
`/p/notes/doc/x.md` boots the shell, renders the client 404 and asks
`/api/nav` for the root tree.

The hardcoded home links (`web/src/shell/Topbar.tsx:24`,
`web/src/pages/NotFoundPage.tsx:13`, `web/src/shell/FileActions.tsx:94`)
and the folder picker root row (`web/src/shell/FolderPicker.tsx:144-146`)
are `<Link to="/">`, which is router-relative and correct.

The open-folders localStorage key (`web/src/shell/NavContext.tsx:13`)
needs a project namespace, and it needs it synchronously:
`useState(readOpen)` reads storage during the first render
(`web/src/shell/NavContext.tsx:75`), two lines below the `/api/me`
request (`:73`) and long before it has answered.

**Every mutation in the client drops the history state today, not only
the save.** `save` reads `res.rev` and shows "Saved" unconditionally
(`web/src/editor/EditorScreen.tsx:316-318`), and `SaveFileResponse`
declares `history_recorded?`, a field the server does not send, instead
of the `history_degraded` it does (`web/src/api/types.ts:134-138`). The
others never see the body at all: `createEntry` and `move` return
`res.path` as a bare string and `deleteEntry` returns `void`
(`web/src/api/client.ts:182-190`, `:222-235`), `UploadResponse` carries
only `path` and `markdown` (`web/src/api/types.ts:212-215`), and create,
rename, delete, upload and restore each show an unconditional success
toast (`web/src/shell/FileActions.tsx:89-99`, `:131-150`,
`web/src/editor/useUploads.ts:59-67`,
`web/src/pages/HistoryPage.tsx:224-235`). Section 9 gives all of them
one small shared shape rather than teaching the warning to the save
alone.

The sidebar comes from `/api/nav?path=` (`web/src/shell/NavContext.tsx:72`,
`server/spa.go:253-263`), not from `/api/tree`, which serves API tokens
(`server/api.go:70-78`).

### auth, read-only and tokens are global

One user list, one session cookie, one token list (`main.go:51-59`,
`auth/tokens.go:105-148`). A write is refused for two reasons today:
server-wide `--read-only`, or a `:ro` token
(`server/api.go:462-472`), and the same pair is asked in advance by
`canWrite` (`server/spa.go:340-342`). `auth.ReadOnlyToken`
(`auth/tokens.go:64-69`) reads the token off the request context.

The public prefixes the middleware lets through without a session are
fixed literals: `/login`, `/api/login`, `/manifest.webmanifest`,
`/static`, `/ping` (`auth/auth.go:74`). Every one of them stays global,
so nothing here moves.

Two details of that middleware decide section 2. `wantsJSON` knows one
API location, the literal prefix `/api/` (`auth/request.go:11`,
`:82-89`), and falls back to the `Accept` header; an unauthenticated
request that is neither gets a 302 to the login form
(`auth/auth.go:228-237`). And `isPublic` matches through
`hasPathPrefix`, which treats a prefix ending in `/` as covering
everything below it (`auth/auth.go:322-329`), so adding `/` to that list
would make the whole server public. Neither is a thing to work around;
both are things to know before moving the API under a prefix.

### logging is configured before anything is read

`main` calls `setupLog(opts.Dbg, secretsOf(opts)...)` immediately after
parsing the flags (`main.go:107-119`), and `run` does every other piece
of work afterwards. A credential read from a file inside `run` is
therefore not in the redaction list `lgr.Secret` was given.

### development and e2e both assume bare paths

`e2e/support/env.js` has one `appBase` constant and a `routes` builder
every spec goes through (`e2e/support/env.js:26-53`). It is not a clean
switch, though: `raw` and `contentHref` deliberately ignore `appBase`
because they are server routes today, and `login` follows it although
`/login` is a global server route. Several specs also write `/api/...`
by hand (`e2e/tests/readonly.spec.js:56-78`,
`e2e/tests/security.spec.js:86-99`, `e2e/tests/mobile.spec.js:351`).

The vite dev server proxies a fixed list of server prefixes - `/api`,
`/raw`, `/static`, `/logout`, `/ping`, `/manifest.webmanifest` - and
treats `/p` and `/login` as shared, where an HTML navigation is bypassed
to vite's own `index.html` and everything else is proxied
(`web/vite.config.ts:8-31`). Two things break under this design. `/api`
and `/raw` stop being root prefixes, so their entries stop matching and
the `/p` rule swallows them; and the `/p` bypass is decided on `Accept`
alone (`vite.config.ts:15`), so opening an attachment at
`/p/notes/raw/img.png` as a top-level navigation is answered with
`index.html` and never reaches `rawHandler`. The base is missing too:
the development `web/index.html` mounts `#scrawl-app-root` with no
`data-base` attribute at all, so the dev bundle runs with the `/`
fallback.

### tests that assume one root

- `validate(opts) (string, error)` (`main.go:412-435`), tested as a
  single returned string (`main_test.go:297-312`), plus
  `checkSecretFile(root, opts)` (`main.go:441`, `main_test.go:317-353`).
- `newHistory(opts, notes)` returns one service (`main.go:283`,
  `main_test.go:355-413`), `indexAll(notes, index)` (`main_test.go:480`)
  and `watch(...)` (`main_test.go:495`, `:521`) each take one of
  everything.
- `newTestServer` in `server/server_test.go:59-108` builds one store over
  one `t.TempDir()` and is used by ~90 call sites across `server_test.go`,
  `spa_test.go`, `shell_test.go`, `history_test.go`; 20 of them poke
  `ts.root` on disk directly. About 250 request literals are bare
  `/api/...` and `/p/...`, and every one of them moves under the prefix.
  That is the single largest mechanical cost of this change, and it is
  also what makes the prefix exercised by the whole handler suite instead
  of by one multi-project test.
- `TestContentURL` and the breadcrumb test assert the bare prefixes
  (`server_test.go:1831-1878`). They keep passing on the prefix rule but
  not on the segment rename: `/p/` becomes `/doc/` in those builders, so
  their expectations move one word.
- `history` tests skip when git is missing, inside `serviceAt`
  (`history/history_test.go:83-97`).

## Approach

### 1. One new type: server.Project

A project is the bundle `run` builds today, named and repeated. It lives
in `server`, because `main` already imports `server` and the dependency
cannot run the other way:

```go
// server
type Project struct {
    Name     string // url slug, "notes"
    Label    string // what the switcher shows, defaults to Name
    Kind     string // "local" or "remote", for /api/projects
    ReadOnly bool   // this project alone, on top of Config.ReadOnly

    Store    *store.Store
    Renderer *render.Renderer
    Index    *search.Index
    History  History // the existing interface, still mockable
}

func (p *Project) Prefix() string { return "/p/" + p.Name }
```

The prefix is derived, not stored, so a name and a prefix cannot drift
apart. It carries **no trailing slash**; section 9 makes that the one
rule on both sides of the wire.

`server.Web` swaps its four singular fields for `Projects []*Project` and
a `byName map[string]*Project`. `History` stays an interface, so the
handler tests keep their fake; it gains the two methods section 5 names
and nothing else.

The handlers do not grow a parameter. They move from `*Web` onto a small
unexported receiver:

```go
type mount struct {
    *Web
    prj *Project
}
```

Inside a handler `wb.Store` becomes `m.prj.Store`, `wb.history()` becomes
`m.prj.History`, and the singular shape every handler is written against
is preserved. The mount has nothing but the project, because a project
has exactly one prefix.

`main` keeps its own wrapper for the things `server` has no use for:

```go
// main
type runtimeProject struct {
    web    *server.Project
    notes  *store.Store     // to Close and to Watch
    hist   *history.Service // to Close and to Sync, concrete
    remote *history.Remote  // nil for a local project
    pull   time.Duration
}
```

Closing, watching, reconciling and syncing are `main`'s job and stay on
the concrete types.

The content path never changes. It stays relative to that project's root,
slash-separated, without a leading slash. The project lives in the URL,
not in the path, so `store` keeps being the only security boundary and
its invariant is untouched.

### 2. URL space

One rule: **everything a project owns lives under `/p/<project>/`,
always, including when there is exactly one project.**

`/p/` means project now, and the page route is `/doc/` inside it:

```
/p/<project>/doc/guide.md          a page
/p/<project>/doc/python/           a directory page
/p/<project>/edit/guide.md         the editor
/p/<project>/history/guide.md      the versions of a document
/p/<project>/search?q=...          search inside this project
/p/<project>/api/...               the project's API
/p/<project>/raw/img.png           a raw file
```

There is no bare route table and no redirect for an old path. `/p/x.md`
is a 404; `/p/notes/doc/x.md` is the page.

Global routes are registered once at the root, and this is the complete
list: `/ping`, `/static/{version}/...`, `/manifest.webmanifest`,
`/login`, `/logout`, `/api/login`, `/api/logout`, `/api/projects`, and
`/`. They are global because `auth`'s public prefixes name several of
them as literals (`auth/auth.go:74`) and because none of them reads a
store. (`/static/{version}/...` is the asset space; it keeps its current
spelling, because renaming it to `/assets/` would touch the CSP, the vite
`base`, the embedded bundle path and the manifest icons and buy nothing.)

That makes the boundary a rule rather than a coincidence: the root is
global, `/p/` is a project, and nothing at the root ever depends on which
project happened to be configured first. Every future endpoint answers
one question - does it read a store? - and lands on one side or the
other.

`/` is a 302 to `/p/<first>/`. That is the only thing the order of
projects in the config decides, and it decides only where a browser
lands: no path anywhere in the server changes meaning because of it, and
no request is ever resolved against a project the caller did not name.
A 302 and not a 308, because the target is a deployment setting the
operator can change by editing the config, and a 308 would be cached past
that edit. The objection to redirecting content routes does not apply
here: `/` is never the target of a `PUT`, and it carries no body.

`/` stays behind auth, and nothing in `auth` changes for it. An
anonymous `GET /` is redirected to `/login?from=%2F`, and after signing
in the form sends the browser back to `/`, which then performs the 302.
Two hops, no new mechanism. This is the one place the review's premise
was wrong: the locked 302 is not lost, it is only preceded by the login
the deployment asked for. Making `/` public would be a new exact-match
public path, because adding it to today's prefix list would open the
whole server (`auth/auth.go:322-329`), and it buys nothing.

**`auth` does have to learn where the API lives.** `wantsJSON` knows
only the literal `/api/` prefix (`auth/request.go:11`, `:82-89`), so an
API client that omits `Accept: application/json` and calls
`/p/notes/api/file/x.md` with a bad or missing token would be handed a
302 to an HTML form instead of a JSON 401. It gains one structural
question next to the literal: a path whose first segment is `p`, whose
second is a project name and whose third is `api` is an API path. Six
lines, no table of projects passed into `auth`, and the answer does not
change when a project is added.

`/p/<name>/` as the prefix, rather than the name as a bare first segment
(`/notes/doc/x.md`): a bare segment would need a reserved-name list
guarding `api`, `raw`, `assets`, `login`, `static`, `ping` and
`manifest.webmanifest`, and that list would have to grow with every new
global route.

Per-project routes are registered once per project under its prefix,
which `routegroup` already supports: `router.Mount("/p/team")` returns a
bundle (`vendor/github.com/go-pkgz/routegroup/group.go:101`). The route
table moves into one method:

```go
func (wb *Web) projectRoutes(g *routegroup.Bundle, prj *Project)
```

`/api/preview` moves in there too, because rendering depends on the
project's link prefixes and its `LinkExists`.

`/api/me` is per project as well. It reports the read-only mode and the
history state of the store it is asked about (`server/spa.go:265-278`),
which differ per project, and the app needs to know which project it is
running under, so it cannot be global. It gains a `project` object naming
the current project and the live remote state. `/api/projects` is the
global counterpart: `/api/me` answers about the project you are in,
`/api/projects` lists what a switcher can go to.

**Fallbacks are per mount.** `NotFoundHandler` is global by construction
(`group.go:196-203`) and knows no prefix, so it cannot boot the app for
`/p/team/unknown`. Each mount registers its own catch-alls, last, after
the explicit routes, and Go's pattern matching prefers the more specific
route:

- `GET <prefix>/api/{path...}` answers a JSON 404, so an unknown API path
  never returns HTML.
- `GET <prefix>/{path...}` serves the shell with status 404 and this
  project's prefix as the base.

The global `NotFoundHandler` is reached only by a path that belongs to no
project, which means an unknown project name or a stray root path. It
answers a plain 404 without a shell, because there is no base it could
honestly give the client.

### 3. Where the prefix appears, and where it must not

On the server, only three places carry `prj.Prefix()`:

1. `render.Options.PagePrefix` and `RawPrefix`, per project.
2. The `/raw/` redirect in `docHandler` (`server/shell.go:207`).
3. `shellData.Base` (`server/shell.go:213-219`).

Everything else stays as it is. The six builders in
`server/page.go:187-224` keep producing router-relative URLs with no
prefix, because their output goes into JSON that the client hands to
`<Link>` and `navigate`, and React Router prepends the basename itself.
They do rename their page segment from `/p/` to `/doc/`, which is the
only change `server_test.go:1831-1878` sees. `breadcrumbs`
(`server/page.go:180`) renames it too: it writes the same URL by hand
instead of calling `dirURL`, so the simplest fix is to make it call
`dirURL` and have one builder left that knows the word. The dead
template funcMap block in `server/server.go:418-428` goes.

**One exception, and it is named rather than smoothed over.** A `/raw/`
URL in JSON is not a route of the app: `contentURL` produces one for any
non-markdown path (`server/page.go:187-194`), and it reaches a client
through a directory entry (`server/page.go:72-87`) and through the
`attachment` handoff (`server/spa.go:148`, `:171`). The server keeps
writing it unprefixed, because prefixing it in JSON would put two kinds
of URL in one field. The rule is on the reading side instead: a `/raw/`
URL from JSON is a content URL the client mounts before use, never a
`<Link>` target. Section 9 says where.

```go
render.New(render.Options{
    LinkExists: prj.Store.Exists,
    PagePrefix: prj.Prefix() + "/doc/",
    RawPrefix:  prj.Prefix() + "/raw/",
})
```

### 4. Configuration: a required name, and one config file

Two new flags decide where the projects come from, not one:

- `--project <name>` (env `PROJECT`, **no default**) names the single
  project when there is no config file. It is required: starting with
  `--root` and no `--project` is a startup error saying exactly that.
- `--config <file>` (env `CONFIG`) declares any number of projects and
  replaces `--project`/`--root`.

The single project of the flag path may be a remote as well, and the
flags mirror the `repo` block field for field: `--repo-url`,
`--repo-branch` and `--repo-pull` (env `REPO_URL`, `REPO_BRANCH`,
`REPO_PULL`). There is deliberately no `--repo-token`: a flag value lands
in `/proc/<pid>/cmdline`, which is world readable, so the credential of
the flag path comes from the environment variable `REPO_TOKEN` and from
nowhere else. It is a fixed name because with one project there is
nothing to disambiguate. Section 6 says how the value is resolved.

**A project name is never derived and never defaulted.** There is no
implicit `notes`, no `default`, and nothing taken from the root
directory's base name. A derived name would make `mv /data/notes
/data/wiki` silently change every URL the deployment serves, and `--root`
accepts directory names that are not URL-safe slugs anyway
(`main.go:412-435`). A defaulted name would put a word nobody chose into
every bookmark. Making it mandatory costs one flag and one error message,
and it means the URL space is always something the operator wrote down.

Both ways of declaring a project stay, because the flag path is about ten
lines of code and it keeps the docker one-liner and `make run` working
with no YAML file to mount.

With `--config`, the file lists the projects and the flags stay the
global defaults:

```yaml
projects:
  - name: notes
    label: Personal notes
    dir: /notes

  - name: team
    label: Team wiki
    dir: /data/team
    read_only: true
    exclude: ["drafts/*"]
    repo:
      url: https://github.com/acme/wiki.git
      branch: main
      token_file: /run/secrets/gh-token   # or token_env: TEAM_TOKEN
      pull: 5m
```

**A project's credential is a file or a variable, never both.** `repo`
takes `token_file: <path>` or `token_env: <VARIABLE>`, and setting both
is a startup error rather than a precedence rule. The variable name is
written out in full and is never derived from the project name, which is
the rule the project name itself already follows. A remote over https
with neither field is the public-repository case: cloning and fetching
work, and section 7 says what happens to a push that has no credential.
Section 6 says how the value is resolved, and the answer is the same
whichever field was given.

Two deployments, one with a mounted secret file and one without:

```
# one project, flags only, credential from the environment
docker run -p 7272:7272 -v /path/to/notes:/notes \
  -e PROJECT=notes \
  -e REPO_URL=https://github.com/acme/wiki.git \
  -e REPO_BRANCH=main \
  -e REPO_TOKEN='Bearer ghp_xxx' \
  ghcr.io/aleksey925/scrawl:latest

# several projects, each naming its own variable with token_env
docker run -p 7272:7272 -v ./scrawl.yml:/etc/scrawl.yml -v team:/data/team \
  -e CONFIG=/etc/scrawl.yml \
  -e TEAM_TOKEN='Bearer ghp_xxx' \
  ghcr.io/aleksey925/scrawl:latest
```

**Every project declares `dir`, and `repo` is optional metadata saying
that directory is a managed clone.** There is no union of `dir` and
`repo`, no hidden `<work-dir>/<name>` derivation and no `--work-dir`
flag. Both consumers of a project directory take an explicit root and
derive nothing (`store/store.go:63`, `history/history.go:84-91`), so the
config says the same thing they do. It is also the only shape in which an
operator can see, in the file, which volume has to survive a restart.

Only `read_only` and `exclude` may be set per project. Everything else
(`--title`, `--max-upload`, `--upload-dir`, `--watch`, `--rescan`,
`--history`, auth, timeouts) stays global.

`read_only` is a floor, never a lift. The effective mode is
`global || project`: a server started with `--read-only` refuses every
write on every project, and `read_only: false` on a project cannot open
it back up. `--read-only` means what it says today (`main.go:40`,
`server/api.go:462-472`), and a per-project value that could override it
would turn a server-wide guard into a suggestion. Only `read_only: true`
does anything, so `read_only: false` is simply the default spelled out.

`exclude` **merges** with the global `--exclude` rather than replacing
it: the global list is the deployment-wide "never show this", and a
project adds its own on top. Both lists go into `store.Config.Exclude`
for that store, and the merged value is what the startup log prints.

YAML, because `go.yaml.in/yaml/v3` is already in `vendor/modules.txt:76`,
so this adds no dependency, only a `require` line promotion. It is
decoded with `KnownFields(true)`
(`vendor/go.yaml.in/yaml/v3/yaml.go:108`), so a misspelled key is a
startup error rather than a setting that silently did nothing.

The file is read **before** `setupLog`. Today logging is configured
immediately after `parseOpts` (`main.go:107-119`), which is before any
file could have been read, so a credential loaded later would never reach
the redaction list. Parsing the config and resolving the credentials -
from a file, from a named variable or from `REPO_TOKEN`, it makes no
difference - moves ahead of `setupLog`, and the resolved values join
`secretsOf` (`main.go:496-511`).

If both `--config` and an explicit `--root` or `--project` are given,
`--config` wins and a `WARN` says they are ignored; go-flags exposes
`Option.IsSet()` to tell an explicit value from the default.

### 5. Remote projects live in history, not in a new package

A remote project is a local project whose directory happens to be a
clone. That is the whole idea, and it is what keeps this small:

- `main` ensures the directory exists before `store.New`. For a remote
  that means cloning when `dir` is missing or empty.
- `store.New` opens it like any other folder.
- `history.New` adopts it exactly as it adopts a user's own repository
  today, including `disableFilters` and the hardened `baseArgs`.
- history is forced `on` for a remote project, whatever `--history` says.
  A remote project that silently stopped recording would also silently
  stop pushing.

`history` grows a small remote surface and nothing else:

```go
type Remote struct {
    URL       string
    Branch    string
    Token     string        // resolved header value, never a path
    PullEvery time.Duration // 0 disables the background pull
    PullOnly  bool          // fetch and merge, never commit or push
}

func Clone(ctx context.Context, dir string, rm Remote) error
func (s *Service) Sync(ctx context.Context) error
func (s *Service) Unpublished() bool
func (s *Service) SyncError() string
```

`Config` gains `Remote *Remote` and `TrackAll bool`.

`Token` is the value, never a path and never the name of a variable.
`token_file`, `token_env` and `REPO_TOKEN` are configuration spellings
and they stop in `main`: it resolves whichever one was given, once,
before `setupLog`, and hands the same string to the redaction list and to
`history`. Section 6 says why rereading the source later would be worse
than it looks.

**A shared runner, because Clone has no service.** `Service.run` is a
method: it takes `cmd.Dir` from `s.root` and the environment from
`s.env()` (`history/git.go:36-66`), and `New` opens the root before
anything else can happen (`history/history.go:114-131`). A clone runs
when there is no directory and therefore no service, so it cannot reuse
`run` as it stands. The small extraction is:

```go
type gitRun struct {
    git     string
    dir     string
    env     []string
    args    []string // after baseArgs
    timeout time.Duration
    limit   int64
}

func runGit(ctx context.Context, r gitRun) ([]byte, error)
```

`Service.run` becomes a two-line wrapper that fills `dir`, `env` and the
defaults from the service. `Clone` fills them from the parent directory
and the same `baseArgs`/`env` rules. One code path, one set of hardening,
and `GIT_TERMINAL_PROMPT=0` guarantees git fails instead of blocking on a
password prompt in both.

**First fetch.** If the directory is missing or empty:
`git clone --branch <b> --single-branch <url> <tmp>` into a sibling
temporary directory, then `os.Rename` it into place. Full depth, not
shallow: a shallow clone breaks `Log` and complicates pushing, and the
corpus is text. The rename is what makes an interrupted clone harmless: a
half-finished tree never sits at the configured path, so the next start
either finds nothing and clones again, or finds a complete clone. Cloning
straight into the final path would leave a directory that is neither
empty nor a valid clone, and the check below would then refuse to start
with no way out but a manual delete.

**Existing clone on restart.** Verify and refuse rather than repair:
`git remote get-url origin` must match the configured URL and
`git rev-parse --abbrev-ref HEAD` must be the configured branch. A
mismatch stops startup. Silently re-cloning or repointing would throw
away commits that were never pushed.

**Startup order, per project, and it is not negotiable.**

```
open store -> Reconcile -> Sync -> indexAll -> Watch -> serve
```

`Watch` installs its watches and takes its baseline snapshot before it
returns (`store/watch.go:94-98`), so anything the worktree did before
that call produces no event, ever. A startup `Sync` fast-forwards the
worktree; if it ran after `Watch`, or after `indexAll` with `Watch`
already up, the merged files would be in the baseline and the index would
stay stale for the whole life of the process. `Reconcile` runs first
because it only commits what is already on disk, and doing it before the
fetch keeps a local change from being what the merge trips over. This
reorders today's code, where `indexAll` runs before `newHistory` and
`reconcile` (`main.go:189`, `:208-216`, `:241`).

**Refresh.** `Sync` is `git fetch --prune origin <branch>`, then
`git merge --ff-only origin/<branch>`, then `publish` unless the project
is pull-only. It runs at
startup, on the `pull` ticker, and it takes `s.mu`, the same lock
`Record` holds. That is the important part: a pull rewrites the worktree,
so it must not interleave with a save, and the lock that already covers
"the mutation and the commit are one critical section" is the right home
for it. After a merge the store's watcher sees the changed files and
reindexes and invalidates the page cache with no extra wiring.

**Publish.** `publish` is `git push origin HEAD:refs/heads/<branch>`. It
runs inside `Record`, under the same lock, right after a successful
commit; at the end of every successful `Reconcile`, for the same reason;
and at the end of every `Sync`.

**Every `Sync` pushes unconditionally.** The push is not gated on
`unpublished`. That state is reported, never a retry gate: making it the
gate would mean a commit that never leaves the container whenever the
measurement below is wrong or has not run yet, and a watcher-driven
`Reconcile` commit (`main.go:389`, `history/write.go:79-103`) on a
project with `pull: 0` has no later tick to catch it. An already
up-to-date push costs one round trip and prints "Everything up-to-date",
which is the cheaper of the two mistakes.

**A read-only remote is pull-only, and it has to be written down.**
Nothing in the code implies it today: `main` reconciles whatever the
mode (`main.go:213-216`, `:383-389`) and `Reconcile` has no read-only
guard (`history/write.go:79-102`), so a public repository configured
`read_only: true` would keep committing and pushing into a remote it has
no credentials for, and would report itself unpublished for changes no
reader ever made. So the effective read-only mode of a **remote**
project sets `PullOnly`, and `PullOnly` means exactly three things:
`Reconcile` is not called for that project, at startup or from its
watcher; `publish` is not called; and the `push --dry-run` probe of
section 7 does not run. Fetch, fast-forward merge, the index, the page
cache and every history read work as usual. A read-only **local**
project is unchanged: it still reconciles what somebody edited over SMB,
because there is no remote for that to reach.

**Publication is its own state, separate from the commit state.** A
failed push must not reuse `pending`/`degraded`. `commitLocked` returns
`nil` when nothing is staged (`history/write.go:121-126`), and `Record`
then clears `pending` and `degraded` (`history/write.go:68-71`). A later
save that changes nothing git can see would therefore report history
healthy while the remote is still behind. The messages are wrong too: a
strict caller would be told the change was "not recorded in history"
(`server/history.go:231-243`, `server/errors.go:49`) when it was recorded
and only not pushed.

So there are two kinds of state side by side, and the publication half
is two fields, because "we are ahead of the remote" and "the last git
conversation failed" are different questions:

| state | set by | cleared by | means |
| --- | --- | --- | --- |
| `pending` + `degraded` | a failed commit | the next commit that stages something | on disk, not in git |
| `unpublished` | a measurement, after every fetch and every push attempt | the same measurement, when it counts zero | in git, not on the remote |
| `syncError` | any git stage that failed while talking to the remote | the next run in which every stage it performed succeeded | the last conversation with the remote failed |

**`unpublished` is measured, not remembered.** It is
`git rev-list --count origin/<branch>..HEAD > 0`: a local, offline
question asked of the last fetched remote ref. A flag set only by a
failed push would be false in a fresh process, so a clone left ahead
of `origin` by the previous run would report itself published until
somebody saved something; and after a restart on a diverged branch the
fetch succeeds, the merge fails and no push is ever attempted, so nothing
would set the flag at all. Measuring answers both cases with one cheap
command and no extra bookkeeping. If the measurement itself fails, the
flag keeps its previous value and the failure goes into `syncError`.

**The transitions, for every stage that can fail.** `Sync` is three
stages and each one has one rule. `publish` inside `Record` and inside
`Reconcile` is the third stage on its own.

| stage | on failure | on success |
| --- | --- | --- |
| fetch | `syncError = "fetch: <redacted git error>"`, stop; `unpublished` is left as it was, because `origin/<branch>` did not move | go on to merge |
| merge `--ff-only` | `syncError = "merge: the branch has diverged from origin/<branch>"` plus the command a human would run, then measure, stop | go on to publish |
| push | `syncError = "push: <redacted git error>"`, then measure | measure, then `syncError = ""` |

`Sync` returns the first error it hit. `syncError` is cleared only by a
run in which every stage it performed succeeded, so a pull-only project
clears it after a successful fetch and merge, and a writable one only
after the push as well. Every transition that sets `syncError` also logs
one `[WARN]` line, and that line names the project: with N projects in
one process, `history: ...` is no longer enough to say which repository
fell behind. `history.Config` therefore gains a `Name`, used for nothing
but the log prefix, which fixes the five existing lines
(`history/history.go:177`, `:275`, `history/write.go:115`, `:228`,
`:259`) at the same time.

`Unpublished()` and `SyncError()` read this state.
`ErrNotPublished` is a new sentinel returned to a strict caller, and
`server/errors.go` maps it to "the change was written and recorded, but
not pushed to the remote". A browser save still returns 200 and carries
`history_degraded` plus a new `unpublished` field; section 9 says what
the client must do with it.

**Three small server-side changes make that state reachable**, and none
of them is optional:

- `server.History` (`server/history.go:20-29`) gains `Unpublished()
  bool` and `SyncError() string`. It is the type `/api/me` and
  `withHistory` hold, so without them neither compiles against
  `Project.History`. `*history.Service` answers both on a nil receiver
  the way `Enabled` and `Degraded` already do
  (`history/history.go:243-248`), and `fakeHistory`
  (`server/history_test.go:29-92`) gains two one-line methods.
- `record` (`server/history.go:246-254`) special-cases
  `history.ErrNotPublished` before its final wrap. Today every
  post-mutation error becomes `errHistoryNotRecorded`, and that sentinel
  is matched first by both `statusOf` and `errMessage`
  (`server/errors.go:22`, `:45-50`), so a strict caller whose push
  failed would be told the change was not recorded when it was.
- `statusOf` and `errMessage` each gain the new case: 500, and the
  message above.

`unpublished` is retried by the next commit and by every `Sync` tick, so
a remote that comes back clears it without anybody restarting anything.

**What gets pushed.** Today only `defaultExtensions` are versioned:
markdown plus the image and pdf types an upload leaves behind
(`history/history.go:63-65`). The editor, meanwhile, opens every type in
`rawTextExtensions`: `.py`, `.toml`, `.yaml`, `.sh` and the rest
(`server/handlers.go:178-186`). On a local project that gap only means a
`.toml` edit is not in the audit trail. On a remote it means the edit
never leaves the container, which is a silent data loss.

A remote project therefore sets `TrackAll: true`, and it does two things,
not one:

- `versioned` returns true for every path. Since it is only consulted on
  the write side (`history/write.go:211`, `:231`, `:262`) and the read
  routes have their own markdown guard (`server/history.go:74`), this
  widens what is committed and nothing else.
- `stage` adds `-f` to the `git add` it already runs
  (`history/write.go:148-157`). The path list is exact and filtered
  before it ever reaches git, so the only thing `-f` overrides is the
  ignore rules the package documents as winning today
  (`history/history.go:11-16`). Without it, a visible file that some
  `.gitignore` in the corpus happens to match can be created, served,
  edited and never pushed. A test covers exactly that: a `.gitignore`
  naming a path the store still shows, a save on it, and the file present
  in the commit.

`Config.Files` already yields every visible file (`main.go:304-316`), so
`Reconcile` picks up the rest of the corpus on the first run.

**Empty directories are local until they hold a file.** Creating a
directory records no path on purpose (`server/api.go:218-225`), and git
cannot represent an empty directory at all. On a remote project a new
empty folder therefore lives in this clone only, and shows up on the
remote as soon as the first note lands in it. That is documented and
otherwise left alone. A hidden `.gitkeep` was rejected: it is a file
scrawl writes into somebody else's repository, invisible to the reader
who would have to delete it, and refusing the operation would break the
create-folder-then-create-note flow the app is built around.

**Conflicts.** `--ff-only` is the whole conflict policy. scrawl never
merges, never rebases and never resolves. If a fast forward is not
possible, the project is diverged: it keeps serving, local saves keep
landing on disk and in local commits, every push keeps failing, and
`Unpublished()` plus `SyncError()` say so in the log and in the one
persistent warning of section 9, together with the exact command a human
would run in the clone. That holds across a restart, because
`unpublished` is measured rather than remembered and the failed merge is
what triggers the measurement. Auto-rebase is deliberately cut; see "Not
in scope".

Divergence needs a second writer, or an upstream change landing between
scrawl's last pull and its next push. For one person and one branch it
should not happen; when it does, it is loud instead of clever.

### 6. Credentials

A credential is always named, never written down inline. The config
names a file (`token_file`) or an environment variable (`token_env`), the
flag path reads the fixed variable `REPO_TOKEN`, and no value reaches
argv from anywhere.

`-c http.extraHeader=...` on the command line would put the token in
`/proc/<pid>/cmdline`, which is world readable, and in any `gitError`
that quoted `c.args`. Instead the header goes into the child environment
of the network commands only, through git's own numbered config
variables:

```
GIT_CONFIG_COUNT=1
GIT_CONFIG_KEY_0=http.extraHeader
GIT_CONFIG_VALUE_0=Authorization: <the resolved token value>
```

`/proc/<pid>/environ` is readable only by the owning uid, unlike
`cmdline`, and `gitError` never sees the value because it is not an
argument.

**`env()` does not build the child environment from scratch.** It starts
from `os.Environ()`, drops every `GIT_*` variable the host set and
appends five pinned pairs (`history/git.go:99-115`). The pair above is
one more `append` there, added only for `clone`, `fetch` and `push`, and
that part holds. What does not hold is the rest of it: scrawl's own
environment is inherited by **every** git call, local ones included,
so a token left in `REPO_TOKEN` or in a `token_env` variable would ride
along on `git log` and `git status` too, for the whole life of the
process.

**So `main` unsets the variable as soon as it has read it.** One
`os.Unsetenv` in the same helper that read it. The win is real but
narrow: the value leaves `/proc/self/environ` of a long-lived process and
stops being inherited by short-lived git children that have no business
seeing it, so the only place it reaches git stays the one pinned pair on
the three network commands. It does nothing about the process manager
that set it - `docker inspect`, the compose file or the systemd unit
still holds the secret, and no amount of unsetting changes that. Nothing
in `history` learns the variable name, so this stays one line in `main`.

The value is a complete header value whatever the source, not a bare
token: `Bearer ghp_...`, or `Basic <base64>`. That is provider neutral
and needs no per-host encoding rule in scrawl.

**The source is read once, and only `main` reads it.** The value is
resolved while the config is parsed, before `setupLog`
(`main.go:107-119`), and the same string goes to `secretsOf` and into
`history.Remote.Token`. `history` never opens a file and never reads a
variable, because it rebuilds the child environment on every call
(`history/git.go:99-115`) and has to redact the identical value out of
`gitError` (`history/git.go:138-150`): a second read could return a
rotated credential that was never registered for redaction, and the log
would then print it in full.

**The source is resolved to one value, and everything downstream is
unchanged.** Reading is the only thing that differs, and it is one
`switch` in one helper:

```go
// main
func resolveToken(file, envVar string) (string, error)
```

Both set is a validation error, not a precedence rule. Neither set
returns the empty string, which is the credential-less public remote
section 7 warns about rather than refuses. After the read, the same three
steps run on whatever came back: strip one trailing `\n` or `\r\n`,
refuse a value holding any other control character, return it. A secret
file that ends in a newline is the normal case and so is a variable
filled from a shell heredoc, while a header value with a `\r` in the
middle is a header-splitting bug waiting for a git version that does not
check. The cost of this whole addition is that
one branch: `secretsOf`, `Remote.Token`, the redaction in `gitError` and
the injection through `GIT_CONFIG_VALUE_0` never learn where the string
came from.

An empty variable counts as unset, and a variable that was **named** and
is unset is a startup error: the operator wrote the name down, so a
missing value is a typo or a missing `-e`, not a choice. `REPO_TOKEN` is
optional instead, because nothing in the configuration named it and an
https remote with no credential is a supported deployment. That needs no
second rule in the helper: the flag path sets `token_env: REPO_TOKEN` on
its one project when the variable is set and leaves it empty when it is
not, which is section 4's promise that both ways of declaring a project
produce the same list before anything else runs.

**ssh has no configuration knob in v1.** An ssh remote works, and it
works the way every other tool on the box works: through the agent and
the `~/.ssh/config` of the uid the process runs as, mounted into the
container. There is no `key_file` setting. The only way to point git at a
named key is `GIT_SSH_COMMAND`, which git hands to a **shell**, while
everything this package runs today goes through `exec.CommandContext`
with literal arguments and no shell (`history/git.go:48`). Building
`ssh -i <path>` from config would import quoting rules, option injection
through a path that starts with `-`, and a host-key policy decision this
design has no opinion on. That is three new problems for a setting a
mounted `~/.ssh` already answers. Named in "Not in scope"; the explicitly
injected HTTPS header flow above stays.

A URL that carries credentials is **refused** at validation. `git clone`
writes the URL into `.git/config`, so an inline password would be
persisted in plain text inside the notes volume, and every later
`remote get-url` check would print it.

Two more redactions, because a header is not the only way a secret
escapes:

- `gitError.Error()` (`history/git.go:145-150`) replaces any argument
  that looks like a credential, and any occurrence of the loaded token
  value, with `***`. It is structural, not a log filter, so it holds
  wherever the error is printed or returned.
- `SyncError()` returns an already-redacted string, because it is shown
  in the UI, which `lgr.Secret` never touches.

`secretsOf` (`main.go:496-511`) gains the resolved token values, whatever
their source, as a second line of defence, which is why the config is
loaded before `setupLog` (section 4).

### 7. Per-project read-only, and no inference

Three ways a write is refused, instead of today's two:

- server-wide `--read-only` (unchanged),
- a `:ro` token (unchanged),
- the project's own `read_only`, which is `store.Config.ReadOnly` on that
  store, with the effective value `global || project` from section 4.

`refuseReadOnly` (`server/api.go:462-472`) and `canWrite`
(`server/spa.go:340-342`) each gain the third case, with its own message.

A public repository with no credentials is **not** inferred to be
read-only. Instead, after the clone, `git push --dry-run` runs once and a
failure produces a loud `WARN`, exactly the shape `warnUnwritable` already
uses for a notes directory the container cannot write
(`main.go:251-263`). The operator sets `read_only: true` if that is what
they meant. No hidden state that depends on a network probe.

The probe is skipped when the project is already read-only. That is the
`PullOnly` rule of section 5 seen from this side: a project that will
never push has nothing to warn about, and probing it once a restart
would only put a failed `push` in the log of a deployment that is
working exactly as configured.

### 8. Shared and per-project resources

| thing | per project or shared | why |
| --- | --- | --- |
| `store.Store` | per project | one `os.Root` per directory, forced |
| watcher goroutine | per project | `notes.Watch(ctx)` is per store |
| `search.Index` | per project | keys are bare paths and would collide; BM25 statistics are per corpus |
| `render.Renderer` | per project | `LinkExists` and the two prefixes differ |
| `history.Service` | per project | already rooted at one directory |
| page cache | **one, shared** | key becomes project name + path |
| auth, sessions, tokens | one | unchanged |

The page cache is the one place where sharing is simpler than splitting:
the key gains a component (`server/cache.go:45`, `:62`, `:92`), and the
64MB bound an operator reasons about stays one number instead of being
divided by the number of projects. `Invalidate`
(`server/server.go:203`) takes the project name too.

Cost of N projects: N copies of the corpus text in RAM (the index holds
the only copy of the stripped text, `search/index.go:57-59`), N tree
walks at startup, N inotify trees, N rescan timers. Worth one startup log
line per project, as `indexAll` already prints (`main.go:347`).

### 9. Frontend

The client already runs under a basename, so the work is making the
physical URLs follow it and leaving the router-relative ones alone.

**One base contract, stated once.** `mountBase()` returns the project
prefix **without a trailing slash**: `/p/notes`. A physical URL is
`base + path` where `path` always begins with `/`. Nothing concatenates a
bare segment onto the base, ever. Today the helper returns the server
value verbatim and falls back to `/` (`web/src/mount.ts:15-18`), which
under a concatenation rule would produce `//api/me`, so the helper
normalizes: strip a trailing slash, and treat `/` as the empty string.
The base is non-empty in every real run, so the fallback is a safety net
and not a mode.

- `server/shell.go` sets `Base` from the serving project instead of the
  constant `appMount` (`server/shell.go:33`, `219`), with no trailing
  slash.
- `web/src/api/client.ts` gets two helpers instead of one:
  `projectUrl(path)` returns `mountBase() + path`, `globalUrl(path)`
  returns `path`. `/api/logout` and `/api/projects` use `globalUrl`,
  because they are registered once at the root and because `auth`'s
  public prefixes name several of them as literals (`auth/auth.go:74`).
  Everything else uses `projectUrl`, applied in `call`, `withQuery`,
  `fileUrl` and `historyUrl` (`client.ts:106-171`). The split mirrors
  the server's root-versus-`/p/` boundary exactly, so there is one rule
  to remember on both sides.
- `web/src/reader/links.ts` matches `mountBase() + '/doc/'` instead of
  the literal `/p/`, and strips `mountBase()` from the pathname before
  returning it, because the result goes to `navigate`, which prepends the
  basename again (`useDocumentControls.ts:98`).
- **The page segment is renamed in three files, not one.**
  `web/src/paths.ts:44-58` builds it, `web/src/routes.tsx:14` registers
  it as `p/*`, and `web/src/shell/naming.ts:21-24` reads it back out of
  a pathname. All three become `doc`. All three are router-relative:
  React Router hands `contentPathOf` a pathname it has already stripped
  the basename from, the route table is matched after the same strip,
  and the builders' output goes back to `<Link>`. Server-produced
  navigation URLs such as `edit_url` stay router-relative for the same
  reason (section 3). An earlier draft said `naming.ts` needed no change
  at all; it was wrong, and the failure it would have shipped is quiet:
  the shell boots, the client 404 renders and the sidebar asks for the
  root tree.
- **The SPA login screen goes, and `/login` becomes a full page load.**
  `routes.tsx:21-25` registers a second login page that the server route
  never serves (`server/server.go:254` answers `GET /login` with
  `login.html`); it is reachable only through a client-side `navigate`,
  which under a basename would put it at `/p/<project>/login` and break
  the locked rule that login is global. So the route, `LoginPage.tsx`
  and the now-unused `api.login` method go, and all four callers - both
  of `AccountMenu`'s, sign out (`AccountMenu.tsx:18-20`) and sign in
  (`AccountMenu.tsx:62`), plus `AppLayout.tsx:73-78` and
  `EditorScreen.tsx:342-345` - use `window.location.assign('/login?from='
  + encodeURIComponent(location.pathname + location.search))`, built
  from the **physical** `window.location` and not from the router's.
  Otherwise the form sends the reader back to a path with no project in
  it. One login screen instead of two is also simply less code: the
  server-rendered form already works without javascript, which is why it
  exists.
- **An attachment is a physical link.** `documentUrl`
  (`web/src/paths.ts:44-46`) keeps only the markdown case and stays
  router-relative; the `/raw/` half moves to `rawUrl(path)`, which
  returns `mountBase() + '/raw/' + ...`. `DirectoryView`
  (`web/src/components/DirectoryView.tsx:38-50`) renders a row as
  `<Link to={entry.url}>` when it is a directory or markdown and as
  `<a href={mountBase() + entry.url}>` otherwise, asking the same
  `isMarkdown` question the rest of the app asks. `AsyncContent`
  (`web/src/components/AsyncContent.tsx:18-22`) switches on the
  handoff's `kind`: `directory` stays a `<Navigate>`, `attachment`
  becomes `location.replace(mountBase() + url)`. Without this the URL in
  the address bar looks right, the raw handler is never asked, and the
  reader gets the app's 404.
- `web/src/shell/NavContext.tsx:13` keys the open-folder set on
  `'scrawl.tree.open'`; it becomes `'scrawl.tree.open:' + mountBase()`.
  From the base, not from `/api/me`: the set is read during the first
  render (`NavContext.tsx:75`) while the `/api/me` request two lines
  above (`:73`) has not answered yet, so a key that waited for it would
  read the wrong bucket first and write it back.
- **Every mutation shows the unpublished state, not just the save.** One
  shared shape in `web/src/api/types.ts`:

  ```ts
  export interface MutationState {
    history_degraded?: boolean;
    unpublished?: boolean;
  }
  ```

  `SaveFileResponse`, `EntryPathResponse`, `RestoreResponse` and
  `UploadResponse` extend it (`types.ts:134-144`, `:196-215`), and
  `SaveFileResponse` loses `history_recorded?`, which the server has
  never sent. The client stops throwing the body away: `createEntry` and
  `move` return the response instead of `res.path`, and `deleteEntry`
  returns the state instead of `void`
  (`web/src/api/client.ts:182-190`, `:222-235`), which is why delete has
  to answer 200 with a body instead of 204 (`server/api.go:257`).
  **Restore needs one more step than an `extends`.** Its adapter does not
  return the response at all: it collapses it into
  `RestoreOutcome = { ok: true } | { ok: false; current: string }`
  (`client.ts:173`, `:247`), so widening `RestoreResponse` alone would
  still leave `HistoryPage` with nothing to show. The success arm becomes
  `{ ok: true; state: MutationState }` and the adapter passes the body's
  state through. One helper next to `showToast` takes a `MutationState`
  and a success message and picks the warning toast when `unpublished` is
  set, and the five call sites go through it: the editor
  (`EditorScreen.tsx:316-318`), create and rename and delete
  (`FileActions.tsx:89-99`, `:131-150`, whose two dialog callbacks pass
  the result up instead of a bare path), upload (`useUploads.ts:59-67`)
  and restore (`HistoryPage.tsx:224-235`, which now has
  `outcome.state` to hand it).

  This was the alternative to narrowing the promise to saves only, and
  the shared shape won on the numbers: one interface, four `extends`,
  four widened return types counting `RestoreOutcome`, one helper and
  five call sites, against a design
  whose whole point is that a change which did not reach the remote is
  loud. A silent failed push on a delete is exactly the failure this
  document set out to remove.
- `/api/me` gains `project: {name, label, kind, read_only, degraded,
  unpublished, sync_error}` and keeps reporting the history state of that
  project. This is where live state lives, because `/api/me` already owns
  it (`server/spa.go:265-278`).

  **The existing top-level `read_only` carries the effective value, it is
  not left alone.** Today it is `wb.ReadOnly` verbatim
  (`server/spa.go:268`), and three places read it: `canWrite` in the
  navigation context, which is what hides every write control
  (`web/src/shell/NavContext.tsx:127`), the editor's `readOnly` prop
  (`web/src/pages/EditPage.tsx:43`) and the account menu's "Read-only
  mode" item (`web/src/shell/AccountMenu.tsx:45`). Adding
  `project.read_only` next to it and leaving the old field at the global
  value would offer a Save button on a read-only project and only refuse
  it at the server. So `read_only` in `/api/me`, and in every entry of
  `/api/projects`, is `global || project` - the same effective value
  section 4 defines and section 7 refuses writes on. Nothing on the
  client changes, which is the point: one field, one meaning,
  three consumers that already do the right thing with it.
- **One persistent place says the project is out of sync, and it is the
  warning that already exists.** `HistoryPage` renders a yellow `Alert`
  when `me.history_degraded` is set (`web/src/pages/HistoryPage.tsx:313`),
  and that is the only persistent warning surface in the app. It moves:
  a small `ProjectAlerts` component reads `me` and renders in
  `AppLayout`, directly above the `<Outlet/>`
  (`web/src/shell/AppLayout.tsx:157-159`), so a reader sees it on every
  screen of the project rather than only after opening a document's
  history. It renders nothing when both flags are clear, the same
  "History fell behind" alert on `history_degraded` keeping its
  `data-testid`, and a second one on `project.unpublished` titled "Not
  pushed to the remote", carrying `project.sync_error` as its body, which
  is already redacted (section 6). `HistoryPage`'s own copy goes, so
  there is one warning surface instead of two.

  A banner on every screen is the cost, and it is the right one: a
  project whose commits are not leaving the container is broken, not
  merely worth a note, and the states are project-wide rather than about
  the document on screen. This is also why `unpublished` reaches the UI
  at all - without a surface it would be a field returned from `/api/me`
  that nobody reads.
- One new global endpoint, `GET /api/projects`, returning
  `[{name, label, url, kind, read_only}]` and nothing else. It is
  immutable switcher data: it reads no store, so the global boundary of
  section 2 stays a rule rather than an exception, and no aggregate
  "state of every project" has to be assembled anywhere. Live state is
  read per project, through the two methods section 5 adds to
  `server.History`. The topbar menu navigates
  to another project's root with a full page load, which re-boots the
  shell with the new basename, so there is no client-side multi-project
  state to hold. With one project the endpoint returns one entry and the
  topbar shows no control.
- The PWA manifest (`server/server.go:337-338`) keeps `start_url` and
  `scope` at `/`, so the installed app still covers every project and
  still opens on the `/` redirect.

**Development.** The vite dev server needs two changes, not one.

The bypass under `/p` is decided on the `Accept` header alone
(`web/vite.config.ts:12`, `:27`), which was right while `/p` held only
app routes. Now `/p/<name>/raw/...` and `/p/<name>/api/...` live under it
too, and a raw file opened as a top-level navigation carries
`Accept: text/html` like any other, so it would be answered with vite's
`index.html` and `rawHandler` would never be asked. The bypass becomes
path-aware: a request whose path matches `/p/<name>/api` or
`/p/<name>/raw`, with anything below it, always proxies, and only the
remaining project routes bypass to `index.html`. `/api` and `/raw` stay
in `serverPaths` as well, because `/api/login`, `/api/logout`,
`/api/projects` and `/logout` are global and still answer at the root.

The other missing piece is the base, which the dev HTML never sets
(`web/index.html:15`). `web/index.html` gains `data-base="/p/notes"` on
the mount node, matching the `--project notes` that `make run` passes.

### 10. Validation at startup

**Validation is two-phase, because half of it cannot run before the
directories exist.** `canonical` resolves symlinks
(`history/history.go:350-361`), and `filepath.EvalSymlinks` fails on a
path that is not there, so the overlap check and the secret-file check
cannot be asked about a remote project whose clone has not happened yet.
The order is:

1. **Syntactic.** Everything answerable from the config text, the
   process environment and the secret files: a project is configured at
   all, the names, the URLs, the branches, the presence of `dir`, the
   credentials, and a **lexical** overlap check on the roots. None of it
   needs a project directory to exist, so a typo fails before a clone is
   attempted.
2. **Ensure.** Create or clone each project's directory (section 5).
3. **Canonical.** Resolve every root, repeat the overlap check on the
   resolved paths, check the session key file, then build the stores.

**The overlap check runs twice, and the first run is what matters.**
Today nothing on disk is touched before the root is confirmed
(`main.go:412-435` only stats). Phase 2 breaks that: a remote whose `dir`
sits inside another project's root would be cloned first and the
configuration rejected afterwards, leaving a clone in somebody else's
notes that the operator has to find and delete by hand. So phase 1 asks
the containment question on `filepath.Abs` plus `filepath.Clean` of each
configured `dir`, which needs no directory to exist and catches every
plainly written overlap. Phase 3 then asks it again on canonical paths,
because only that catches two symlink spellings of one directory, and by
then the worst a rejection costs is a clone of a path the operator
spelled two ways.

`validate` grows from "the root is a directory" to a global part plus a
per-project part, split along that line:

- at least one project is configured. An empty `projects:` list, or
  `--root` with no `--project`, is a startup error naming the missing
  piece;
- the name is present, is a URL-safe slug (`[a-z0-9][a-z0-9_-]*`) and is
  unique. No name is reserved: names live under `/p/`, and inside a
  project the next segment is one of the fixed route words, so a project
  name can collide with nothing;
- `dir` is set. Whether it **is** a directory is phase 3, because for a
  remote it is not one yet;
- a `repo.url` carries no credentials (section 6);
- `repo.branch` is accepted by `git check-ref-format --branch`. The
  branch is interpolated into `origin/<branch>` and
  `HEAD:refs/heads/<branch>`, so a name git would read as something else
  has to be refused before the first fetch, not after it;
- a project sets at most one of `repo.token_file` and `repo.token_env`.
  Both is an error naming the project, never a precedence rule
  (section 6);
- a named variable has a value: `repo.token_env` pointing at a variable
  that is unset or empty is an error. The fixed `REPO_TOKEN` of the flag
  path is optional and its absence is not;
- a resolved token value, from either source, holds no control character
  beyond the one trailing newline that is stripped (section 6);
- no two `dir` values overlap lexically, on `Abs` plus `Clean`.

Then the directories are ensured, and phase 3 asks the rest:

- every `dir` is a directory;
- no project root contains another project root, and none contains the
  other's parent. The comparison is between **canonical** paths, resolved
  with the same `canonical` helper `history` uses
  (`history/history.go:350-361`), so two symlink spellings of one
  directory cannot slip past as distinct roots. Two overlapping roots
  would mean two watchers, two indexes and two repositories over the same
  files, and `history` would hit `ErrInsideRepo` anyway
  (`history/history.go:74`);
- the session key file lives outside **every** canonical project root,
  which is what `checkSecretFile` (`main.go:441-454`) checks against one
  today. It also becomes canonical, which it is not today: it applies
  `filepath.Abs` to both sides and compares strings (`main.go:446`,
  `:450`), so once the roots are resolved a secret path spelled through a
  symlink would compare unequal and a signing key sitting inside a served
  project would pass. The file itself often does not exist yet - `auth`
  creates it on first start (`auth/session.go:222-232`) - so
  `EvalSymlinks` is applied to its **parent directory**, which does exist
  by then, and the base name is joined back on.

## Migration

This is a one-time breaking change, and it is the only one. Every URL a
reader or a script uses moves under `/p/<project>/`, the page segment
becomes `/doc/`, and no old path is redirected. A deployment that
upgrades sees 404s until bookmarks and scripts are updated. `/` keeps
working: it is a 302 to the first project.

`--project` is also newly required, so an existing `docker run` line that
passed only `--root` fails at startup with a message naming the flag
rather than serving something under a name nobody chose.

Before and after, for a single-project install run with
`--root /notes --project notes`:

| | before | after |
| --- | --- | --- |
| page | `/p/python/notes.md` | `/p/notes/doc/python/notes.md` |
| directory | `/p/python/` | `/p/notes/doc/python/` |
| editor | `/edit/python/notes.md` | `/p/notes/edit/python/notes.md` |
| versions | `/history/python/notes.md` | `/p/notes/history/python/notes.md` |
| search | `/search?q=x` | `/p/notes/search?q=x` |
| raw | `/raw/python/notes/d.png` | `/p/notes/raw/python/notes/d.png` |
| api | `GET /api/file/x.md` | `GET /p/notes/api/file/x.md` |

Unchanged: `/login`, `/logout`, `/api/login`, `/api/logout`, `/static/`,
`/manifest.webmanifest`, `/ping`. New and global: `/api/projects`.

Inside this repository the change touches:

- `e2e/`: more than the one constant. `e2e/support/env.js:26-53` gets two
  builders instead of one implicit rule, `project(path)` and
  `global(path)`, and `routes` is rebuilt on them: `doc`, `dir`, `edit`,
  `history`, `search`, `raw` and `contentHref` all become project routes,
  while `login` becomes a global one - it follows `appBase` today
  (`env.js:46`) and that is wrong the moment the base is not empty. The
  specs that write `/api/...` by hand
  (`e2e/tests/readonly.spec.js:56-78`, `e2e/tests/security.spec.js:86-99`,
  `e2e/tests/mobile.spec.js:351`) go through the builders instead.
  `e2e/support/docs.js` needs no change: it maps roles to content paths,
  not to URLs. `e2e/tests/login.spec.js:40-63` drives the SPA login
  screen by test id; with that screen gone it drives the server form the
  way `submitCredentials` already does (`e2e/support/helpers.js:36-43`),
  and reads the error the template renders. Two specs also assert a raw
  URL as a literal rather than through `routes.raw`:
  `e2e/tests/upload.spec.js:62` expects `src` to equal
  `/raw/<path>` and `e2e/tests/reading.spec.js:143` selects on
  `img[src^="/raw/"]`. Both move to the project prefix.
- `e2e/support/serve.js:45`: the launcher passes `--root` and nothing
  else, so every instance fails to start the moment `--project` is
  mandatory. It gains `--project=${inst.project}` and a `--config` branch
  for an instance that declares more than one project.
- `e2e/playwright.config.js:54`: `webServer` lists the four instances one
  by one, so a fifth entry in `env.js` launches nothing until the config
  lists it too.
- `web/index.html:15`: a `data-base` for the dev shell.
- `server/*_test.go`: about 250 bare `/api/...` and `/p/...` request
  literals go through one helper on the test server.
- `README.md`: the `curl` examples (`README.md:178-180`, `:203-206`), the
  `/raw/` sentence (`:196`), the first-run instructions (`:28`), and the
  now-required `--project`.
- `img/`: retake any screenshot that shows a URL.
- `examples/data` and `make run`: the sample corpus is unchanged, but
  `make run` gains `--project notes` and the URL it prints moves.
- `CLAUDE.md`: the URL rules, plus the correction about `/app` and the
  `/p/` pages that is stale today anyway.

## Key decisions

**One subtree per project, not a project name inside every namespace.**
The alternative spreads the name across the existing prefixes -
`/p/<project>/...` for pages, `/api/<project>/...`, `/raw/<project>/...`
- and keeps today's inner shape. It was rejected. One subtree gives the
SPA a single basename, which is the whole reason the router work in
section 9 is three small changes instead of a rule per namespace. It
makes a reverse proxy trivial: one `location /p/team/` line hands a whole
project somewhere else, where the spread version needs three rules kept
in sync. And it leaves room for per-project access rules later, because a
project is one contiguous path prefix a middleware can be mounted on
rather than a segment three route tables have to agree about.

**The inner segments move too, and `/p/` changes meaning.** `/p/` is the
project now and the page is `/doc/`. Backwards compatibility is already
dropped, so renaming the inner segments costs nothing on top, and it buys
the property above: one project is exactly one subtree, with no leftover
route of the old shape to explain.

**Every project carries a prefix, including the only one.** The obvious
kinder design mounts the first project at the bare paths too, so that a
single-project install keeps its URLs. It was rejected. It splits the URL
space in two, it makes the first project answer under two URL trees at
once, and it turns the router-relative versus physical distinction into a
latent trap: with an empty basename both kinds of URL look identical, so
a mistake ships and only surfaces in somebody's multi-project deployment.
Making the prefix non-empty in every run and every test moves that
failure from latent to always-exercised, and it costs one breaking change
once instead of a branch in every future frontend feature.

**A project is a URL prefix, never a path segment inside the content
path.** The alternative, making the project the first segment of the
content path so that nothing in the router changes, was rejected: it
collides with real folder names, it breaks the CLAUDE.md invariant that a
content path is relative to the root, and it would put a project name
inside the string that `store` treats as untrusted input. Keeping the
project out of the path leaves `store` as the only security boundary,
unchanged.

**`/p/<name>/` and not a bare first segment.** `/notes/doc/x.md` would
need a reserved-name list guarding `api`, `raw`, `assets`, `login` and
every global route added later; a fixed prefix segment needs none.

**Global endpoints stay at the root, and that boundary is permanent.**
`/login`, `/logout`, `/api/login`, `/api/logout`, `/api/projects`,
`/static/`, `/manifest.webmanifest` and `/ping` are global because they
read no store, not because bare paths happen to mean the first project.
Every future endpoint answers the same question and lands on one side.
`/api/projects` is held to that rule rather than excused from it: it
returns configured, immutable facts, and live per-project state stays in
`/api/me`, which already reports exactly that shape for the store it is
asked about (`server/spa.go:265-278`).

**A project name is always written down by a human.** Mandatory
`--project`, mandatory `name:` in the config, no derivation from the
directory and no fallback word. A derived name turns a `mv` into a
site-wide URL change; a defaulted one puts a name nobody picked into
every bookmark and every proxy rule. The cost is one flag and one error
message at startup.

**Two ways to declare a project, and that is deliberate.** The flag pair
`--root`/`--project` is about ten lines of code and keeps the docker
one-liner and `make run` working with no YAML file to mount; `--config`
covers everything richer. Neither is a special case of the other in the
code: both produce the same list of projects before anything else runs.

**`/` is a redirect, not a landing page, and not a default.** A project
picker would be a new screen with its own layout, empty state and
navigation, for a choice the topbar switcher already offers once the
reader is inside a project. 302 and not 308, because the first project is
a config setting the operator can change. It is the only place in the
design where anything is picked on the reader's behalf, and it decides
only where a browser lands: no path ever resolves against an unnamed
project, so this is a convenience, not a hidden default.

**`Project` lives in `server`, not in `main`.** `main` imports `server`
(`main.go:28`), so a `main.Project` could never be a `server.Web` field.
Putting it in `server` also keeps `History` the interface it already is
(`server/history.go:20-29`), so the handler tests keep their fake instead
of needing a git repository. `main` holds a wrapper of its own for the
concrete stores and services it has to close, watch and sync.

**Server JSON carries router-relative URLs, the renderer carries physical
ones.** `edit_url` goes into a `<Link>` (`server/spa.go:235`,
`DocumentBody.tsx:26`) and React Router prepends the basename, so a
prefix in the JSON would produce `/p/notes/p/notes/...`. A rendered
`href` is fetched by the browser directly and needs the prefix. The line
between the two is what decides where `prj.Prefix()` appears, and it is
three places (section 3).

**The base has no trailing slash, and a path always has a leading one.**
One rule, `url(path) = base + path`, on the server, in the API client, in
the link matcher and in the storage key. The alternative, a base that
ends in `/` with bare segments concatenated onto it, is what produced two
readings of the same helper while this design was being written. There is
now exactly one reading.

**`/raw/` in JSON is the one URL the client has to mount itself.** A
directory listing and an attachment handoff both name a path the browser
fetches directly (`server/page.go:72-87`, `server/spa.go:148`), and the
client renders them today as router navigations. Prefixing them on the
server was rejected: `DirEntry.URL` would then hold a router-relative
URL for a note and a mounted one for a picture, which is the exact
confusion the rest of this section exists to remove. The reading side
decides instead, and it asks the question the whole app already asks:
is this markdown.

**One login screen, and it is the server's.** The SPA login page is
unreachable by URL - the server owns `GET /login` - so it exists only
for a client-side `navigate`, which under a basename lands inside the
project. Cutting it removes a duplicate screen, a duplicate error path
and the `api.login` method, and it makes logout and session expiry
ordinary full page loads to a global route. The cost is a `location.
assign` in three places and one e2e spec moving to the server form's
selectors.

**Every mutation carries the publication state, not just the save.** The
cheaper option was to narrow the promise: warn on save, stay silent on
create, rename, delete, upload and restore. It was rejected because the
whole point of a separate publication state is that a change which never
left the container is loud, and a deletion that never left is the worst
one to lose. The shared `MutationState` costs one interface, four
`extends`, four widened return types, one toast helper and five call
sites, and it is the same shape everywhere, so the next mutation
endpoint gets the behaviour by declaring the fields. Restore is the one
that needs more than an `extends`: its adapter collapses the body into
`RestoreOutcome` (`web/src/api/client.ts:173`, `:247`), so the state has
to be carried on the success arm or `HistoryPage` still has nothing to
show.

**A credential is resolved once, in `main`.** `history` never opens
`token_file` and never reads a variable. Logging is configured before
anything else runs (`main.go:107-119`) and the redaction list is fixed at
that moment, so a second read inside `history` could hand git a rotated
secret that is not in the list, and `gitError` would print it. One read,
one trailing newline trimmed, control characters refused, one value
passed to both consumers.

**Two sources for that credential, one resolution.** A project names a
file with `token_file` or a variable with `token_env`, and the
single-project flag path reads the fixed `REPO_TOKEN`, because a
deployment that has no secret store to mount a file from still has
`docker run -e`. Exactly one of the two config fields may be set and both
is a startup error, because a precedence rule between a file and a
variable is a thing an operator has to remember at the worst possible
moment. The variable name is written out and never derived from the
project name, the same rule the project name itself follows. Everything
after the read is shared, so the addition is one branch in one helper and
no new concept: `secretsOf`, `history.Remote.Token`, the redaction and
the `GIT_CONFIG_VALUE_0` injection never learn where the string came
from.

**A read-only remote never writes to git at all.** Read-only means the
reader cannot write; the code takes it further for a remote and skips
reconciliation, publishing and the write probe, because a project that
cannot push has nothing to gain from trying and everything to lose from
reporting itself unpublished for changes nobody made. A read-only local
project keeps reconciling, because there is no remote for that to reach
and the SMB edit is still worth recording.

**A config file, not a repeated flag.** A project has seven fields. The
repeated-entry precedent in this codebase (`--auth.users`,
`--auth.tokens`, `name:secret[:ro]`, `auth/tokens.go:105-148`) tops out at
three and is already at the edge of readable. A `--project-spec` flag
would need a mini-language with nested key/value pairs, which is a parser
nobody wants to debug. YAML is already vendored, the project already
ships a `docker-compose.yml`, and a container mounts one more file.

**Every project declares its directory; `repo` only says it is a clone.**
The earlier shape had `dir` and `repo` as alternatives plus a
`--work-dir` under which a remote's directory was derived as
`<work-dir>/<name>`. That was rejected: it added a flag, it hid the one
path an operator has to put on a volume, and it contradicted both
consumers, which take an explicit root and derive nothing
(`store/store.go:63`, `history/history.go:84-91`). With `dir` always
present, a remote is a local project plus a clone, in the config exactly
as in the code.

**Global read-only is a ceiling, global excludes are a floor.**
`--read-only` is a server-wide guard today (`main.go:40`,
`server/api.go:462-472`), and a per-project `read_only: false` that could
lift it would make the guard a suggestion, so the effective value is
`global || project`. `exclude` goes the other way and merges, because a
global exclude is a deployment-wide "never show this" and a project can
only add to it.

That effective value is also what goes on the wire. `/api/me.read_only`
is `wb.ReadOnly` verbatim today (`server/spa.go:268`) and three consumers
hang off it - `canWrite` (`NavContext.tsx:127`), the editor
(`EditPage.tsx:43`) and the account menu (`AccountMenu.tsx:45`). Adding
`project.read_only` beside it and leaving the old field global would
offer Save on a read-only project and refuse it only after the reader
pressed it. One field, the effective value, no client migration.

**Shelling out to git, reusing `history`.** A library was rejected on the
spot: `history` already shells out, the hardening
(`history/git.go:70-115`) is the interesting part and it is written, and
adding `go-git` would mean a second, differently-behaving git in the same
binary. The remote mode is `history` plus a clone, a fetch, an ff-only
merge and a push. It reuses `Record`'s lock, `pending`, `Op.Strict` and
`Reconcile` untouched, and adds one small runner extraction so that
`Clone`, which has no service yet, runs under the same rules.

**Publication is a second state, not a reuse of `degraded`.** The commit
failure machine clears itself on the next commit that stages nothing
(`history/write.go:121-126`, `:68-71`), which would report a healthy
history while the remote was still behind, and would tell a strict caller
the change was "not recorded" when it was recorded and only not pushed.
Two flags, two messages, one retry path.

**`unpublished` is measured, not remembered, and never the retry gate.**
It is `git rev-list --count origin/<branch>..HEAD > 0`, asked after every
fetch and every push attempt. A flag only set by a failed push would be
false in a fresh process whose clone is ahead of `origin`, and on a
diverged branch after a restart no push is even attempted - the ff-only
merge fails first - so nothing would ever set it and the divergence the
design promises to make loud would be invisible. Measuring is one cheap
local command and it is correct in both cases. The push stays
unconditional regardless: gating it on the state would trade a wasted
round trip for a commit that never leaves the container.

**Out of sync is shown in one persistent place, and it is the warning
that already exists.** `HistoryPage`'s "History fell behind" alert
(`web/src/pages/HistoryPage.tsx:313`) is the app's only persistent
warning surface. It moves into a small component rendered by `AppLayout`
above the outlet and takes `unpublished` with it, so both project-wide
states are visible on every screen instead of behind a click into one
document's history. Returning `unpublished` from `/api/me` without a
surface would be a field nobody reads, and a second surface next to the
first would be one more shape to keep consistent. One component, two
conditions, one place.

**Startup order is part of the design, not an implementation detail.**
`Watch` takes its baseline when it is called (`store/watch.go:94-98`), so
a fast-forward merge that happens after it produces no event and the
index stays stale until something else touches the file. Reconcile, then
`Sync`, then `indexAll`, then `Watch`.

**A remote tracks every visible file, and `-f` is what makes that true.**
Local history versions a fixed extension list
(`history/history.go:63-65`) while the editor opens far more
(`server/handlers.go:178-186`), so `TrackAll` widens `versioned`. But
staging already passes an exact, filtered path list
(`history/write.go:148-157`) and ignore rules still win over it by
design (`history/history.go:11-16`), so widening `versioned` alone would
leave a visible-but-ignored file unpushable. `git add -f` on that same
exact list closes it without loosening anything about which paths are
staged.

**Credentials never reach argv, and ssh gets no knob.** `--gen-hash`
already warns that a secret on the command line lands in `ps`, in the
shell history and in `docker inspect` (`main.go:472-475`). So there is no
`--repo-token` and no `--token` of any kind: a flag may name a variable,
never carry its value. `GIT_CONFIG_COUNT` and friends put the header in
the environment instead, which is readable only by the owning uid, and
keeps it out of `gitError`, which quotes arguments
(`history/git.go:145-150`). `main` unsets the source variable right after
reading it, because `env()` inherits `os.Environ()` rather than building
the child environment from scratch (`history/git.go:99-115`), so a
variable left in place would be handed to every git call instead of only
to the three that talk to a remote. A credential-bearing
URL is refused outright, because `git clone` persists it in
`.git/config`. `key_file` is cut: `GIT_SSH_COMMAND` is a shell-parsed
command line, not a key-file variable, and this package runs git with no
shell at all today (`history/git.go:48`). A mounted ssh agent or
`~/.ssh/config` answers the same need with none of the quoting and
host-key questions.

**Read-only is declared, never inferred.** A `git push --dry-run` probe
that silently flipped a project to read-only would be a mode nobody
configured, changing with the network. A loud `WARN` plus an explicit
`read_only` flag is the pattern `warnUnwritable` already established.

**One shared page cache, per-project everything else.** Splitting the
cache would divide a memory bound by a count nobody wants to think about.
Sharing the index is impossible: the keys are bare paths.

**One process, not one per project behind a proxy.** Running N instances
of today's binary behind a reverse proxy is genuinely the zero-change
answer, and the e2e suite already does exactly that
(`e2e/support/env.js`, four instances on four ports). It was rejected
because it gives no shared session, no project switcher, no single
`Authorization` token across projects, and it pushes the routing into a
proxy the project does not ship. It is worth naming in the README as the
answer for someone who wants strict isolation between projects.

## Risks / open questions

- **Old URLs stop working.** This is the one breaking change, it is
  deliberate, and "Migration" lists what it costs. The risk that remains
  is external: links other people saved. `/` redirects, so the entry
  point survives; a deep link does not.
- **`--project` is newly required.** An upgrade that only changes the
  image tag fails to start. That is the intended failure mode - it is
  louder and cheaper than serving every URL under a name nobody chose -
  but it belongs at the top of the release notes.
- **A pull rewrites files under a reader.** The merge takes the history
  lock, so it cannot interleave with a save, but a reader with a note open
  can see it change under them. The editor already has a conflict path for
  this (`store.ConflictError`, `server/api.go:164-165`), so a save on a
  stale revision comes back as the conflict dialog the user already knows.
  Worth confirming the flow end to end.
- **Push latency is in the save path.** A slow remote makes a save take as
  long as a push. The git timeout bounds it (10s by default,
  `history/history.go:44`), and a timeout leaves the save standing with
  `unpublished` set, which the next commit or the next `Sync` retries. If
  this bites, the answer is a `push:` mode in the project config, not a
  redesign.
- **`unpublished` needs `origin/<branch>` to exist.** It is measured
  against the last fetched remote ref, which a clone always leaves
  behind. If the very first fetch of a run fails, the measurement fails
  too, the flag keeps its previous value and only `syncError` says
  anything. That is the right order of honesty - the banner says the
  remote could not be reached - but it means "not pushed" and "cannot
  reach the remote" are two lines, not one.
- **An unconditional push on every `Sync` tick talks to the remote even
  when nothing changed.** That is one `push` that prints "Everything
  up-to-date" per `pull` interval per remote project. Accepted: the
  alternative is a retry gate that loses commits across a restart.
- **A credential in an environment variable is visible to whoever set
  it.** `docker inspect`, `docker compose config`, a systemd unit and the
  shell history of the person who typed the command all keep the value,
  and unsetting it inside the process does nothing about any of them. A
  mounted file is still the better option where a secret store can
  provide one; `token_env` is for the deployment that has no such store,
  and the README should say so next to both.
- **An ephemeral container loses unpushed commits.** A remote project's
  clone lives at its configured `dir`. If that is not a volume, a restart
  re-clones and anything that never pushed is gone. This cannot be
  detected; it has to be documented next to the docker recipe, and `dir`
  being explicit in the config is what makes it visible at all.
- **inotify budget.** The DSM case in `store/watch.go:417-422` pins
  `max_user_watches` to 8192 for the whole host. N projects multiply the
  watch count. The existing fallback to polling still applies per store,
  but the warning should name the project.
- **An empty folder on a remote project is local.** Git cannot represent
  one, and scrawl writes no placeholder. It reaches the remote with the
  first note inside it. Documented, not solved.
- **Search is per project.** BM25 scores from two indexes are not
  comparable (the idf terms come from different corpora), so a merged
  ranking would be wrong, not just approximate. See "Not in scope".
- **The dev shell's base is a constant.** `web/index.html` hardcodes
  `data-base="/p/notes"`, so a developer who runs the backend with a
  different `--project` gets a bundle whose basename does not match.
  `make run` pins `--project notes`; anything else is a two-word edit.
- **A missed `/p/` to `/doc/` rename fails quietly.** The segment is
  spelled out in the route table, in the path builders and in the
  pathname reader, and a page that boots the shell and renders the
  client 404 looks like a routing bug rather than a stale literal. The
  guard is a direct load - not a click - of a document, a directory, the
  editor and the history page under a non-empty basename, in the e2e
  suite.
- **Logout and session expiry leave the SPA.** They become full page
  loads, so an unsaved editor draft has to be flushed before the
  navigation. The editor already flushes on a 401
  (`EditorScreen.tsx:342-345`); the two shell callers have nothing to
  flush, and `confirmLeave` no longer sees the navigation because the
  router is not involved. Worth one pass through the editor flow.
- **CLAUDE.md is stale** about the frontend: it says the react app answers
  at `/app` and the server-rendered `/p/` pages are canonical, but
  `appMount` is `/` (`server/shell.go:33`) and `server/templates/` holds
  only `login.html`. Fix that in the same change, since this design
  depends on the real shape.
- **`--history=off` applies to local projects while a remote forces it
  on.** One process can have history on for one project and off for
  another. That is honest, and it is a line in the README.

## Not in scope for the first version

- Cross-project search. Each project searches itself.
- A sidebar that shows several projects in one tree.
- Per-project authentication or per-project tokens. Anyone who can sign
  in sees every project.
- Auto-rebase, auto-merge or any conflict resolution UI. Divergence is a
  loud unpublished state with a documented manual fix.
- An ssh `key_file` setting. An ssh remote uses the agent and the
  `~/.ssh` mounted into the container; see section 6.
- Moving or copying a document between projects.
- Adding, removing or reconfiguring a project without a restart.
- Webhooks or any push-triggered pull, in this design. Here the refresh
  is a clone-side ticker; they are designed separately in
  `docs/plans/20260914-project-webhooks.md`, on top of this one.
- Shallow clones, submodules and git-lfs. `history` already unsets the
  filter attribute, so lfs is already out by design.
- A landing page or a project-picker screen at `/`. `/` is a 302 to the
  first configured project, whatever the number of projects, and the
  topbar switcher is the whole project-picking UI.
- Redirects from the old bare paths to `/p/<project>/`. The move is a
  clean break; see "Migration".
- A placeholder file that would let an empty folder reach a remote.
- A client-rendered login screen. `GET /login` is the server's form, it
  works without javascript, and one screen cannot drift from the other.
- Renaming `/static/` to `/assets/`. It is already global and already
  works; the rename would touch the CSP, the vite `base`, the embedded
  bundle path and the manifest icons for no behaviour change.

## Implementation outline

Each step should leave the tree building and the tests green.

1. **Delete the dead funcMap block.**
   `server/server.go:418-428` registers `server/page.go`'s builders for
   templates that no longer use them. Remove it. The builders stay
   package functions returning router-relative URLs, which is what
   section 3 keeps them as.

2. **The prefix, end to end, in one commit.**
   This is one big step and it cannot be smaller: `Web` loses
   `Store/Renderer/Index/History`, which `main` sets today
   (`main.go:218-239`), so the server move and the `main` adapter have
   to land together, and the client and the e2e helpers have to move
   with them or every browser test is red. The parts:
   - **server.** Add `Project` with `Store/Renderer/Index/History` and
     `Prefix()`, move every handler from `*Web` onto `mount{*Web, prj}`,
     give `Web` `Projects []*Project` and `byName`, move the route table
     into `projectRoutes(g, prj)` and mount it at `/p/<name>` with
     `/doc/`, `/edit/`, `/history/`, `/search`, `/api/` and `/raw/`
     inside it. Rename the page segment in `server/page.go:187-224` to
     `/doc/`, make `breadcrumbs` (`server/page.go:180`) call `dirURL`
     instead of spelling the same URL out, and move
     `server_test.go:1831-1878` with them. Register the
     per-mount fallbacks, make the global `NotFoundHandler` a plain 404,
     and add the `/` redirect. Set the renderer prefixes,
     `shellData.Base` (no trailing slash) and the `/raw/` redirect from
     `prj.Prefix()`. Key the page cache by project name plus path
     (`server/cache.go:45`, `:62`, `:92`) and give `Invalidate` the
     name. `newTestServer` (`server/server_test.go:59-108`) builds one
     project, keeps `ts.root`, and gains one helper that prefixes a
     request path; the ~250 bare literals go through it.
   - **auth.** `wantsJSON` (`auth/request.go:82-89`) recognizes
     `/p/<name>/api[/...]` structurally. `/` stays non-public.
   - **main.** Move the per-root wiring out of `run`
     (`main.go:166-249`) into `newProject(cfg) (*runtimeProject,
     error)`: store, renderer, history, `warnUnwritable`, and the
     `*server.Project` it produces. Keep the startup order of section 5
     outside it: open store, `Reconcile`, `Sync`, `indexAll`, `Watch`.
     `run` calls it in a loop that already handles N. Add `--project`,
     required, with no default. Split `validate` into the syntactic part
     and the canonical part of section 10, and make `checkSecretFile`
     take the list of roots. One watcher goroutine per project
     (`main.go:362-394`). Update `main_test.go:273-353`.
   - **client.** The normalized `mountBase()` in `web/src/mount.ts`,
     `projectUrl`/`globalUrl` in `web/src/api/client.ts`, the base-aware
     and base-stripping `internalTarget` in `web/src/reader/links.ts`,
     the `/p/` to `/doc/` rename in `web/src/paths.ts:44-58`,
     `web/src/routes.tsx:14` and `web/src/shell/naming.ts:21-24`, the
     `rawUrl` split with its two call sites in `DirectoryView` and
     `AsyncContent`, the removal of the SPA login route with its four
     callers moved to a full page load (both of `AccountMenu`'s,
     `AppLayout`'s and the editor's), and the base-namespaced storage
     key in `web/src/shell/NavContext.tsx:13`. `web/index.html` gets
     `data-base` and `web/vite.config.ts` the path-aware bypass of
     section 9. `make ui` and commit `server/assets/app/`.
   - **e2e.** Give every instance in `e2e/support/env.js` a `project`
     name and pass it as `--project` from the launcher
     (`e2e/support/serve.js:45`), without which nothing starts at all.
     Rebuild the `routes` builders on `project()`/`global()`, move
     `login` to `global()`, convert the hand-written `/api/...` literals
     in `readonly.spec.js`, `security.spec.js` and `mobile.spec.js` and
     the hardcoded `/raw/` expectations in `upload.spec.js:62` and
     `reading.spec.js:143`, move `login.spec.js:40-63` onto the server
     form, and add a direct load (`page.goto`, not a click) of a
     document, a directory, the editor and the history page, which is
     what catches a segment rename that was missed in one of the three
     files.

3. **Add the config file.**
   `--config`, a `projects:` document, YAML through the vendored
   `go.yaml.in/yaml/v3` with `KnownFields(true)`. Promote it to a direct
   require, run `make deps`. Load it and resolve its credentials
   **before** `setupLog` and extend `secretsOf`. `resolveToken(file,
   envVar)` is the whole credential story: at most one of the two,
   `os.ReadFile` or `os.LookupEnv` plus `os.Unsetenv`, then the shared
   trim-and-refuse step (section 6). Validation in the two phases of
   section 10: syntactic first (at least one project, slug names,
   unique, `dir` present, no credentials in a URL, a branch
   `git check-ref-format --branch` accepts, not both token fields, a
   named variable that has a value, a clean token value), then canonical
   (every `dir` a directory, no overlapping roots, the secret file
   outside all of them). Read-only is `global || project`, excludes
   merge. Tests cover the branch rather than the plumbing: a file and a
   variable resolving to the same value, both fields set rejected, a
   `token_env` pointing at nothing rejected, a trailing `\n` stripped
   from either source, an embedded `\r` refused, and the variable gone
   from `os.Environ()` afterwards.

4. **The switcher.**
   `GET /api/projects` as a global route returning
   `{name, label, url, kind, read_only}`, the `project` object in
   `/api/me`, the topbar menu that navigates to another project's root
   with a full page load. `make ui`.

5. **Extract the git runner.**
   Pull `runGit` out of `Service.run` (`history/git.go:36-66`) with an
   explicit working directory, environment, timeout and output cap, and
   make `Service.run` a wrapper. Redact `gitError.Error()` structurally.
   No behaviour change; the existing `history` tests cover it.

6. **Remote projects in `history`.**
   `Remote` (with a resolved `Token` and `PullOnly`) and `TrackAll` in
   `Config`, `Clone` (temp sibling plus rename), `Sync` (fetch, ff-only
   merge, unconditional push), `publish` at the end of `Record` and of
   `Reconcile`, `Unpublished` measured with
   `rev-list --count origin/<branch>..HEAD`, `SyncError` set by every
   failing stage and cleared only by a run in which every stage it
   performed succeeded, `ErrNotPublished`, that pair kept separate from
   `pending`/`degraded`, `Config.Name` for the log prefix, `git add -f`
   under `TrackAll`, the credential injection through `GIT_CONFIG_COUNT`
   on network commands only, and the `origin`/branch verification for an
   existing clone. Tests follow the `serviceAt` pattern
   (`history/history_test.go:83-97`) with a bare repository in a second
   temp directory as the remote, so no network is needed. Five of them
   cover the traps: a failed push followed by a save that stages nothing,
   with `Unpublished()` still true; a service restarted while ahead of
   `origin`, with the next `Sync` pushing; a service restarted on a
   diverged branch, where the fetch succeeds, the ff-only merge fails and
   `Unpublished()` plus `SyncError()` are both set without a push ever
   being attempted; a visible file matched by a `.gitignore` in the
   corpus, which must still reach the remote; and a `PullOnly` service
   that fast-forwards, never pushes and clears `SyncError` after the
   merge.

7. **Wire remotes into main.**
   Add the single-project remote flags `--repo-url`, `--repo-branch` and
   `--repo-pull` (section 4), which with `REPO_TOKEN` build the same
   project the config file builds. Clone into the project's `dir`
   between the syntactic and the canonical validation phases, force
   history on and `TrackAll` on for a remote project, run the startup
   `Sync` in the order of section 5,
   start the `pull` ticker per remote project, set `PullOnly` from the
   effective read-only mode, and run the `push --dry-run` probe with its
   `WARN` for everything else.

8. **Per-project read-only and the publication state, end to end.**
   Third case in `refuseReadOnly` (`server/api.go:462-472`) and in
   `canWrite` (`server/spa.go:340-342`), with its own message.
   `Unpublished()` and `SyncError()` on the `server.History` interface
   (`server/history.go:20-29`), on the nil `*history.Service` and on
   `fakeHistory` (`server/history_test.go:29-92`). `unpublished` in
   `withHistory` (`server/history.go:266-272`) so every mutating JSON
   response carries it; delete answers 200 with that body instead of a
   bare 204 (`server/api.go:257`), which is the only mutating endpoint
   without one. `ErrNotPublished` special-cased in `record`
   (`server/history.go:246-254`) before the `errHistoryNotRecorded`
   wrap, plus its case in `statusOf` and `errMessage`
   (`server/errors.go:22`, `:45-50`), with a test that a strict caller
   whose push failed is told about the push and not about the commit.
   `/api/me` reports `read_only` as `global || project` and gains the
   `project` object (`server/spa.go:265-278`), with a test that a
   project-only read-only server answers `read_only: true`.
   `MutationState` in `web/src/api/types.ts`, the widened return types in
   `web/src/api/client.ts` including the `RestoreOutcome` success arm
   carrying the state, the shared toast helper and its five call sites,
   and `ProjectAlerts` in `AppLayout` taking over `HistoryPage`'s
   degraded alert (section 9). `make ui`.

9. **e2e.**
    A fifth instance in `e2e/support/env.js` with two projects over two
    temp roots. It needs three things, not one: `serve.js` learns to
    write a config file for an instance that declares more than one
    project and pass it as `--config` instead of `--root`/`--project`;
    `e2e/playwright.config.js:54` gains a fifth `webServer` entry, since
    that list is written out one instance at a time and an entry in
    `env.js` alone launches nothing; and `docs.js` gains a role for the
    second project. Then a spec that covers: both projects reachable
    under `/p/<name>/doc/`, the switcher, `/` redirecting to the first
    project, a save landing in the right root, and a missing `--project`
    failing at startup. A remote project is covered by a local bare
    repository as the origin, so the suite still needs no network.

10. **Documentation.**
    README: the new URL shape and the migration table, the required
    `--project`, the config file, the remote mode, the credential options
    (`token_file`, `token_env` and `REPO_TOKEN` for https with the
    warning above about what an environment variable is visible to, a
    mounted agent for ssh), the volume warning
    for a remote project's `dir`, the empty-folder note for remotes, and
    the reverse-proxy alternative for strict isolation. Retake any
    screenshot in `img/` that shows a URL. CLAUDE.md: the project rule,
    the `/p/<project>/` URL rule, the global-versus-project boundary, the
    router-relative versus physical URL rule and the base contract, the
    ff-only rule, the two history states, and the correction about `/app`
    and the `/p/` pages.

11. **`make lint`, `make race`, `make e2e`.**
