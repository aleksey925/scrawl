# Showing that something has not reached the remote

## Problem

A remote project can fail to publish, and today the reader would never
know. The multi-source design records the state - `unpublished`,
`syncError`, `history_degraded` - and gives it one home, a banner above
the outlet. That closes the "nobody is told" half of the problem and
leaves three holes:

1. **The banner is the only surface.** It scrolls away with the page, it
   says nothing about *which* note is at risk, and the reader who is
   looking at the editor and nothing else meets it only by scrolling
   back up.
2. **The state never refreshes.** `/api/me` is fetched once, on mount
   (`web/src/shell/NavContext.tsx:73`). After a failed push the person
   keeps editing; when a later `Sync` finally succeeds nothing refetches
   it, so the banner stays up until a reload. The reverse is just as bad:
   a `Sync` that fails in the background while nobody is saving puts up
   no banner at all.
3. **There is no per-file signal.** "Something in this project has not
   been pushed" is not the same question as "is the note I am reading
   right now on the remote".

What the user asked for, in their words: a push that failed must be
visible everywhere, not only on the history screen; a per-file marker; an
overall status at the top; non-blocking, but never a surprise.

**The guarantee this design actually delivers, stated once and exactly.**
Every screen of the app shell, for the project the reader is in, shows
the state without a reload. It is not installation-wide: another project
can be broken while the reader sits in this one and hears nothing until
they switch to it. It is not outside the shell either: `/raw/` serves an
attachment with no chrome at all (`server/handlers.go:113-145`), so an
attachment is covered by the badge on the directory row that links to it,
not by the raw response. "Everywhere" below always means this.

This document designs that. It adds one measurement in `history`, one
accessor that reads the whole project state in a single load, one field
on an endpoint that already exists, three small client hooks and two
components. It reuses the locked `ProjectAlerts` rather than building
beside it, and it cuts several ideas that cost more than they give.

## Context

### What the two existing designs already decided, and is not reopened

From `docs/plans/20260914-multi-source-repos.md`:

- A project is the unit, addressed under `/p/<project>/`, and
  `server.Project` carries `Store`, `Renderer`, `Index` and `History`.
- `Sync` is fetch, ff-only merge, then push unless the project is
  pull-only. Every stage that fails sets `syncError` with a stage word:
  `fetch`, `merge` or `push`. `Sync` returns the first error it hit, so
  **at most one stage word is current at any moment**. That is the single
  biggest simplification this design inherits.
- `unpublished` is **measured**, never remembered:
  `git rev-list --count origin/<branch>..HEAD > 0`. The transition table
  measures it at the terminal points of an attempt: after a merge that
  failed, and after every push attempt. A fetch that failed leaves it as
  it was. If the measurement itself fails the flag keeps its previous
  value.
- Startup order is `open store -> Reconcile -> Sync -> indexAll ->
  Watch -> serve`, so a project has already had one full `Sync` before
  the first request reaches it. Section 2 leans on this.
- `publish` runs inside `Record`, under the same lock, right after a
  successful commit, so every save pushes and every save measures.
- `history_degraded` already exists and means something different: a
  local commit failed, so the file is on disk and not in git
  (`history/write.go:107-117`, `history/history.go:243-248`).
- Every mutating JSON response carries a small `MutationState`
  (`history_degraded`, `unpublished`), and one helper beside `showToast`
  turns it into a toast at five call sites.
- `/api/me` gains `project: {name, label, kind, read_only, degraded,
  unpublished, sync_error}`. `SyncError()` returns an already-redacted
  string, safe to render.
- A `ProjectAlerts` component reads `me` and renders above the
  `<Outlet/>` in `AppLayout` (`web/src/shell/AppLayout.tsx:157-159`),
  taking over `HistoryPage`'s degraded alert
  (`web/src/pages/HistoryPage.tsx:313-322`).
- `/api/projects` is **immutable switcher data** and reads no store. Live
  state is per project and lives in `/api/me`. Section "Not covered"
  takes this seriously rather than working around it.
- A pull-only project never commits and never pushes, so it can never be
  unpublished.
- History answers only for paths the app would serve anyway: markdown and
  visible to `store` (`server/history.go:66-75`, `store/store.go:186`).

From `docs/plans/20260914-project-webhooks.md`:

- A webhook is a second trigger for the same `Sync`, coalesced through a
  capacity-one channel in `main`. Nothing here changes it, and nothing
  here depends on it beyond the fact that a `Sync` can happen with no
  user action at all - which is exactly what hole 2 above is about.
- `pull: 0` is a supported configuration: a project with a hook and no
  poll has no ticker at all. Section 2 keeps the alert text honest about
  that.
- Being **behind** the remote is named there as invisible. Section 5b
  below decides what this design does about it.

### What the tree gives us today

**`history` holds its state in two shapes already.** `degraded` is an
`atomic.Bool` and `pending` is a map under `s.mu`
(`history/history.go:99-105`). The atomic is what lets `Degraded()`
answer while a commit holds the lock. Any state a handler reads has to be
readable the same way: `Sync` takes `s.mu` for the length of a network
round trip, and `/api/me` must not queue behind it.

**`history.Config` already takes a store callback.** `Files func()
([]string, error)` is how the service asks the store what it may see
(`history/history.go:83-89`). A second predicate fits the same slot; see
section 1.

**Every git call is bounded, and buffered.** `run` takes a timeout and an
output cap and collects stdout into memory (`history/git.go:36-66`);
`maxListBytes = 32 << 20` already exists for reading a whole index
(`history/git.go:14-20`). A new read-only command needs no new machinery,
but it is not free: see the cost paragraph in section 1.

**Git errors keep their detail.** `gitError` carries the arguments and up
to 8 KiB of stderr (`history/git.go:138-152`), which is what makes the
redacted `syncError` string worth putting in front of a reader at all.

**`/api/me` is small and is the only place the client learns about
modes.** `meResponse` is seven fields (`server/spa.go:96-105`), assembled
in `apiMe` (`server/spa.go:267-280`) from `wb.history().Enabled()` and
`.Degraded()`. It goes out through `writeJSON`
(`server/server.go:464-476`), which sets a content type and no cache
policy at all.

**The sidebar, the directory listing, search and the document all carry a
content path already.** `navNode.Path` (`server/spa.go:81-89`),
`DirEntry.Path` (`server/page.go:60-67`), `hit.path` in the search
results (`web/src/pages/SearchPage.tsx:50`) and `pageResponse.DocPath`
are all present and all reach the client. Nothing has to be added to
those payloads for a per-file marker; see section 3.

**A directory holding an `index.md` is served under the directory's own
address, so the route does not name the file.** `apiDir` hands that file
to `writeDoc` (`server/spa.go:180-183`, `:212`), which answers with
`path` set to the directory and `doc_path` set to the file
(`server/spa.go:237`). The root is the same case with an empty `path`,
and it is the most visited page in the app. The client derives the
current path from the route alone (`web/src/shell/naming.ts:21-24`), so
on `/p/` and `/p/notes/` it holds `""` and `"notes"` while the file on
screen is `index.md` and `notes/index.md`. A per-file test against the
route path would therefore say nothing about the note the reader is
looking at. Section 3 keys the current-file signal off the file instead.
`/edit/` and `/history/` do not have this problem: both URLs are built
from `doc_path` already (`server/spa.go:246`,
`historyUrl(doc.doc_path)` in `DocumentBody.tsx:40`), so on those two
routes the route path *is* the file.

**The client fetches exactly two things for the shell.**
`NavProvider` runs `api.nav(currentPath)` with deps
`[currentPath, token]` and `api.me()` with deps `[token]`
(`web/src/shell/NavContext.tsx:71-73`). `token` is bumped only by
`refresh()` (`:116`), which only `FileActions` calls, after create,
rename and delete (`web/src/shell/FileActions.tsx:96`, `:138`, `:154`).
So the tree follows navigation, `me` follows nothing, and one `refresh()`
refetches both.

**`useApi` drops its data on every refetch.** `setState({ loading: true })`
(`web/src/api/useApi.ts:23`) clears `data` before the request goes out.
`canWrite` requires `me` to be defined (`NavContext.tsx:127`), so a
periodic refetch through `useApi` would flash every write control off
once a tick - and today's single `refresh()` empties the sidebar for a
round trip every time a save reports a problem. This is the concrete
reason section 5 splits the two refreshes and moves `me` off `useApi`.

**`showToast` is a module-level function** (`web/src/toast.ts:12`). It
cannot read React context, so the locked `MutationState` helper beside it
cannot refresh anything by itself. Section 5 wraps it in a hook.

**A 401 on any request notifies a handler.** `notifyUnauthorized`
prefers the `'screen'` scope over `'shell'`
(`web/src/api/client.ts:89-92`), so the editor's session-expiry dialog
wins while the editor is mounted. A background request would therefore be
able to open a modal nobody asked for; section 5 gives the poll a quiet
mode for that reason.

**A session renews itself on any authenticated request.** `Middleware`
reissues the cookie once less than half the TTL is left
(`auth/auth.go:219-225`), which `TestServiceMiddlewareSlidingRenewal`
locks down (`auth/auth_test.go:363-390`). A timer that sends an
authenticated request is therefore a timer that keeps a session alive.
Section 5 deals with this; it is the one security-relevant change here.

**The topbar is where a persistent control belongs, and it is already
full.** `AppShell.Header` does not scroll, it already holds a portal slot
for page actions (`web/src/shell/Topbar.tsx:91`,
`web/src/shell/ShellSlots.tsx:24-27`), and it already has the pattern for
"full control on a wide screen, icon only on a narrow one" in the search
button pair (`Topbar.tsx:93-113`, `visibleFrom`/`hiddenFrom` on
`layoutBreakpoints.compactTopbar`). But the row is `wrap="nowrap"`
(`Topbar.tsx:55`) and at phone width it already carries the burger, the
breadcrumbs, the page-actions slot with two buttons, a search icon,
sometimes a table-of-contents icon, the theme toggle and the account
menu. Section 8 spends exactly one new element there and no more.

**`VisuallyHidden` is the project's pattern for an icon that has to
speak.** The editor's layout control pairs an icon with a
`VisuallyHidden` label (`web/src/editor/EditorScreen.tsx:437-446`). A
bare `<svg>` is not focusable, so a `Tooltip` around one never opens on
keyboard focus and an `aria-label` on it is not reliably announced;
section 7 follows the editor instead.

**A warning colour exists in both schemes.** `warning` is `#9a6400`
light and `#ffb340` dark (`web/src/theme.ts:108`, `:128`), published as
`--scrawl-warning` by `cssVariablesResolver` (`web/src/theme.ts:184-196`).
The one existing persistent warning uses Mantine's `color="yellow"`
(`web/src/pages/HistoryPage.tsx:316`). No new token is needed.

**There is no frontend test runner.** `web/package.json:5-10` has `dev`,
`build`, `typecheck` and `preview` and no test script, and no test
framework is installed. The browser suite in `e2e/` is the only place a
client behaviour can be asserted, and its Playwright is 1.63, which has
both `page.route` and `page.clock`.

## States

### 1. Where per-file state comes from

**The command.**

```
git diff --name-only -z origin/<branch>...HEAD
```

Three dots, not two. With `--ff-only` as the whole merge policy, `HEAD`
is normally a descendant of `origin/<branch>` and the two spellings agree.
They differ in exactly the case that matters most: a **diverged** branch.
A two-dot diff there would also list every path the *remote* changed, and
those files would wear a "not pushed" badge although nobody here touched
them. Three dots diffs from the merge base, which is "what this copy
changed since it forked" - the right answer in both cases, from one
command.

**It runs only when we are already ahead.** `unpublished` stays exactly
what the multi-source design locked: `rev-list --count`. The diff runs
only when that count is non-zero. So the steady state costs what it costs
today, one `rev-list`, and the second command appears only in the state
this whole document is about.

**What it costs, honestly.** A merge-base walk bounded by the divergence
plus a tree diff that short-circuits on identical subtree object ids. The
work is small for the ordinary failure - a few commits, a few files - but
it is not a one-off: it repeats at every measurement point, which means
every failed save and every `pull` tick for as long as the project stays
ahead. `run` also buffers the whole output in memory, so with
`limit: maxListBytes` a pathological corpus can hand us 32 MiB before the
cap bites (`history/git.go:14`, `:36-66`). Both are accepted for now,
because the command only ever runs while the project is already broken,
and the cap is the same one `Log` already lives with. Streaming the
output is a later optimisation, not part of this design.

**When it is recomputed: the existing rhythm, and one swap.** Every place
the locked table measures `unpublished` - the terminal points of `Sync`,
and `publish` inside `Record` and `Reconcile` - measures the path set in
the same breath. There is no timer, no cache invalidation and no second
trigger. The three values are built into one immutable struct and
published **once**, when the attempt ends, so a reader can never observe
a half-updated state: no "ahead with no error" window while a healthy
push is still in flight. Section 2 depends on this and cuts a whole UI
state because of it.

**Where it is held.** On `*history.Service`, in that immutable struct
swapped through an `atomic.Pointer`, beside `degraded`
(`history/history.go:99-105`):

```go
// Unsynced lists the paths this copy has committed and the remote does
// not have. Paths is empty and Many is true above the cap: a partial
// list would read as "these files and no others", which is worse than
// saying nothing about files at all.
type Unsynced struct {
    Paths []string
    Many  bool
}

// SyncState is the whole remote state of one project as one attempt left
// it. It is read in a single load, so an error can never be paired with
// the paths of a different attempt.
type SyncState struct {
    Unpublished bool
    Error       string // already redacted
    Unsynced    Unsynced
}

func (s *Service) SyncState() SyncState
```

Lock-free, because `Sync` holds `s.mu` across a network round trip
(`history/write.go:56-57`) and `/api/me` must never queue behind it.

**One accessor, one load, because three getters can tear.** The locked
`Unpublished()` and `SyncError()` stay exactly as the multi-source
design defines them, and they read the same pointer. But `/api/me` must
not call them one after the other: a `Sync` finishing between two calls
would hand the client an old error with a new path set, or the reverse,
and the poll of section 5 would leave that impossible pair on screen for
a minute. So `SyncState()` is the accessor `apiMe` uses, once, and there
is no separate `Unsynced()` getter to misuse.

`record` keeps reading `Degraded()` and `Unpublished()` separately for
its `MutationState`, and that is not the same problem: `degraded` is an
`atomic.Bool` outside this snapshot (`history/history.go:99-105`), so no
single load could ever pair the two, and the toast is followed by one
`refreshMe()` round trip that settles the screen anyway.

**The visibility filter moves into `history`, and runs before the cap.**
With `TrackAll` on, the diff holds every tracked path, a file the store
hides included. Shipping one of those in `/api/me` would be a second way
into the notes with no policy on it, which is the exact reason
`server/history.go:66-75` exists. Filtering in `apiMe` after `history`
had already capped the raw set would be wrong twice over:

- **The order is a bug.** 201 hidden paths would set `Many` and suppress
  every badge, although exactly one visible note changed.
- **The cost is not what it looks like.** `Store.Visible` is not a
  pattern test: `checkPath` walks the path component by component and
  calls `Lstat` on each prefix to rule out a symlink
  (`store/store.go:186-189`, `:632-658`). At the cap that is hundreds of
  `Lstat` calls, and in `apiMe` it would be hundreds per poll per tab.

So `history.Config` gains one field beside `Files`:

```go
Visible func(string) bool // nil means everything the diff lists
```

`history` filters with it and then caps, so the cap counts what a reader
could actually see, and the walk is paid once per measurement instead of
once per request. `server` ships the set through untouched.

**The cap, and what happens above it.** `unsyncedCap = 200`, the same
order as `historyLimit` (`server/history.go:17`). Above it the list is
**dropped entirely** and `Many` is set. This is not a compromise, it is
the correct form: past two hundred unpushed files the reader's question
has changed from "which note?" to "the whole corpus", and a per-file
badge answers a question nobody is asking. The alert then says "many
files" instead of drawing two thousand badges the eye cannot use.

**No counts anywhere.** An exact number is what makes this expensive: it
forces the whole diff to be read and counted past the cap, and it buys a
digit nobody acts on. "Some notes" and "many files" are the two forms,
and the badges are the detail.

**Memory cost per project.** 200 paths at roughly 80 bytes is under 16 KB
worst case, and zero bytes whenever the project is in sync, which is
almost always. On the wire it is the same 16 KB on an `/api/me` that is
fetched once a minute at most. Both are noise.

### 2. Every state the UI tells apart

`syncError` carries one stage word at a time, so the remote states are
mutually exclusive by construction. `history_degraded` is a separate
family. At most two states are true at once, one from each family.

| key | true when | title | banner | badge |
| --- | --- | --- | --- | --- |
| `off` | no remote, or history off | - | no | no |
| `pull-only` | the project never pushes | - | no | no |
| `clean` | nothing failed | - | no | no |
| `push` | `sync_error` starts `push:` | "Changes are not reaching the remote" | yes | yes |
| `fetch` | `sync_error` starts `fetch:` | "The remote cannot be reached" | yes | if any |
| `merge` | `sync_error` starts `merge:` | "This project has diverged from the remote" | yes | yes |
| `degraded` | `history_degraded` | "Changes are not being recorded" | yes | no |

**The bodies, and why each sentence is true in every configuration.**

- `push`: "The change is saved here and recorded in history, it has not
  reached the remote." Then the redacted reason. Then "The next save
  tries again." - which is true with no ticker and no webhook, because
  `publish` runs inside `Record`. The earlier draft said "scrawl keeps
  trying", which is false for a project with `pull: 0` and no hook.
- `fetch`, with nothing unpublished: "This copy may be behind the
  remote." Then the reason.
- `fetch`, with unpublished paths: "This copy may be behind the remote,
  and what was changed here has not reached it either." Then the reason.
  The earlier draft said "Nothing local is at risk", which is simply
  false in this case.
- `merge`: "scrawl never merges by hand. Nothing more will reach the
  remote until this is resolved in the clone." Then the reason, which
  already carries the command a human would run.
- `degraded`: "A change reached the disk and history did not record it.
  The next save that succeeds folds it in."

**How many files, in the two forms section 1 names.** One last sentence
on the body, and never a count: with a path set, "Some notes are
affected; the sync control lists them."; with `many` set, "Many files
are affected, too many to list."; with an empty set, nothing at all.
`degraded` on its own adds none of this, because it says nothing about
which paths the remote is missing. This is the only place "some notes"
and "many files" are written, and `syncMessage` is the only thing that
writes them.

**`waiting` is cut.** The earlier draft had a seventh state - ahead of
the remote with no error - with a badge and no banner. It is gone,
because after section 1's single swap it is barely a state of the model
at all: a healthy push is never observed half-done, and startup runs a
full `Sync` before the first request is served, so there is no
between-boot-and-first-sync window for a browser to catch either. What
was left was a badge that a poll could latch onto during a healthy
background push and keep for another minute after success - a warning
about nothing. Cutting it removes a table row, a precedence rank and a
class of false alarm.

The one residue is the net-zero commit of the risks section:
`rev-list --count` above zero with an empty diff. The UI keys badges off
the path set and the alert off the error, so that case shows nothing,
which is correct.

**Precedence, and what it actually decides.** The order is

```
degraded > merge > fetch > push > clean
```

and it decides **the title only**. `degraded` wins a title because it is
the only state where the change has no record at all - not merely
unpushed, unrecorded. `merge` comes next because it is the only remote
state that will never fix itself. `fetch` outranks `push` because an
unreachable remote explains the failed push and the failed push does not
explain the unreachable remote.

**One alert, composed from both active facts.** Earlier this document had
the winner supply the title *and* the body, with one trailing sentence
for the loser. That loses the thing the reader most needs: with
`degraded` and `push` both true, the exact remote stage and its git
reason disappeared behind the degraded text, and the stock sentence "the
remote is also not reachable" was wrong for a permission failure and for
a non-fast-forward. So: the winner gives the title, and the body carries
both bodies in precedence order, each with its own reason. At most two
states are true, so the body is at most two short paragraphs and one
`<Code>`. Two amber boxes above every screen would still be the opposite
of calm; one box with two sentences is not.

### 5b. Being behind the remote: out of scope, and it costs nothing

The webhook design names this as invisible. This design does **not**
cover it, and the reason is that it is almost not reachable:

- `Sync` is fetch and then an immediate ff-only merge, in one call, under
  one lock. After a fetch that succeeded, this copy is behind for the few
  milliseconds between the two stages, or it is diverged - and diverged
  is the `merge` state above, which is covered loudly.
- The one genuinely invisible case is "the remote moved and we never
  fetched": a lost webhook delivery on a project with `pull: 0`.
  Detecting it requires a fetch, which is exactly what the safety-net
  poll the webhook design recommends already is.

So there is nothing to add here, and adding a "behind" indicator would
mean either a second measurement that can only report a state the merge
has already resolved, or a fetch on a request path. Named in "Not
covered".

## Approach

### Server side

**One new method on `history.Service`,** `SyncState()`, reading the
snapshot section 1 describes in one load, and one new optional
`Config.Visible` predicate. Nothing else in `history` changes: `Sync`,
`Record`, `Reconcile`, the lock and the credential injection are used
exactly as the multi-source design left them.

**One new method on the `server.History` interface**
(`server/history.go:20-29`), beside the two that design already adds:

```go
SyncState() history.SyncState
```

A nil `*history.Service` answers the zero value the way `Enabled` and
`Degraded` already do (`history/history.go:243-248`), and `fakeHistory`
(`server/history_test.go:29-92`) gains one line.

**One new field on `/api/me`,** inside the `project` object the
multi-source design already adds (`server/spa.go:96-105`, `:267-280`):

```go
Unsynced struct {
    Paths []string `json:"paths"`
    Many  bool     `json:"many"`
} `json:"unsynced"`
```

already filtered by `history`, so `apiMe` copies it out and does nothing
else. That is the whole server side of the per-file marker.

**`apiMe` calls `SyncState()` exactly once** and fills `unpublished`,
`sync_error` and `unsynced` from that one value (`server/spa.go:267-280`
assembles the response field by field today, which is what makes this
worth saying out loud). One load, one consistent project object.

**`apiMe` sets `Cache-Control: private, no-store`.** `writeJSON` sets no
cache policy (`server/server.go:464-476`), and an endpoint that a timer
now polls for freshness must not be servable from a browser or proxy
cache. One line in `apiMe`, next to the existing `no-store` on the shell
(`server/shell.go:238`).

**`auth` stops renewing a session for a background request.** See section
5; it is one predicate in `auth/request.go` and one condition in
`Middleware`.

**Nothing is added to `navNode`, `DirEntry`, the search hits or
`pageResponse`.** This is the decision that makes the feature small. A
per-path flag on those payloads would mean the tree walk
(`server/page.go:110-130`), the directory listing (`server/page.go:69-89`)
and the page response each consult history, and - much worse - it would
mean the client has to refetch the tree to refresh a badge. One set in
`/api/me` and a membership test on the client answers every surface from
one round trip. See "Key decisions".

### 3. Client side, surface by surface

The set arrives once and every surface asks it the same question.
`NavContext` gains three things beside the state it already publishes
(`web/src/shell/NavContext.tsx:33-46`):

```ts
sync: SyncMessage | undefined;   // the resolved alert of section 2
isUnsynced: (path: string) => boolean;
currentDoc: string;              // the file on screen, not the route
```

built from a `Set` over `me.project.unsynced.paths`, memoized on the
array. `isUnsynced` returns false when `many` is true, so the degraded
form draws no badges anywhere by construction rather than by each
surface remembering to check.

**`currentDoc` is the file, and a document registers it.** As the
Context section shows, a directory with an `index.md` - the root above
all - is served under the directory's address, so `currentPath` is `""`
or `"notes"` while the note on screen is `index.md` or
`notes/index.md`. `currentPath` stays what it is, because the tree and
the breadcrumbs want the route. Beside it:

```ts
export function useCurrentDoc(docPath: string): void
```

`DocumentBody` calls it with `doc.doc_path` and is the only caller. That
is enough for every case, because `DocumentBody` is the one component
that renders a document, from the document route
(`DocumentView.tsx:43`) and from the directory route when the folder has
an index (`DirectoryView.tsx:23-24`). The hook sets the value on mount
and clears it on unmount; React runs the cleanup of the old document
before the effect of the new one, so the value never points at the note
the reader just left. `currentDoc` falls back to `currentPath` whenever
no document is mounted, which is the right answer for `/edit/` and
`/history/`: both routes already name the file.

Everything that asks "is the note on screen unsynced" asks
`isUnsynced(currentDoc)`. Only the sync control of section 4 asks it.

**One rule about where a badge may live: never in the topbar.** The
topbar row is `nowrap` and already crowded at phone width
(`Topbar.tsx:55`, and the list in "What the tree gives us today"). So
badges go in lists and in page bodies, and the one topbar element this
feature adds speaks for the current file itself; see section 4. This
rule is what keeps the mobile header from clipping and it is why the
document header, the editor header and the history page's action group
get no badge of their own.

**Sidebar tree rows** (`web/src/shell/SidebarNav.tsx:43-110`). The row is
already a `Group` holding a twisty, an `Anchor` and a `RowMenu` (`:109`).
`SyncBadge` goes between the `Anchor` and the `RowMenu`. Outside the
link, so the link's accessible name stays the note's name. Data:
`node.path`, already there.

**Directory listing rows**
(`web/src/components/DirectoryView.tsx:38-54`). The same badge in a third
`Table.Td`, from `entry.path`, already there. Worth doing because a
directory listing is the only surface that shows attachments, and with
`TrackAll` an unpushed image is a real case - and, per the Problem
section, it is the only warning an attachment gets, since `/raw/` has no
chrome.

**Search results** (`web/src/pages/SearchPage.tsx:50-64`). The same badge
beside the result's `Anchor`, from `hit.path`, already there. No payload
change. A search is how a reader reaches a note without the tree, so
leaving it out would have been a hole in the guarantee.

**The missing-document screen**
(`web/src/components/DocumentView.tsx:23-41`). A deletion that failed to
push leaves the note gone here and present on the remote, and visiting it
directly renders this branch, which today says only "This note does not
exist yet." The badge goes next to the `Title`. Same predicate, same
path, no payload change.

**The document, the editor and the history page.** No badge of their own,
by the topbar rule above. All three are covered by the sync control of
section 4, which names `currentDoc` when `currentDoc` is in the set -
and on a wide screen the tree row beside them carries the badge as well,
including for a directory index, which is an ordinary markdown row on
the tree like any other note.

**The project switcher.** Nothing. `/api/projects` is locked as immutable
data that reads no store, so a badge there would need an aggregate
endpoint crossing the global/project boundary. See "Not covered".

**`ProjectAlerts`** (locked, in `AppLayout`) renders the one alert of
section 2: `color="yellow"`, `IconAlertTriangle`, title and body from one
shared function

```ts
function syncMessage(me: MeResponse): SyncMessage | undefined
```

which composes both active facts as section 2 describes, so the alert and
the sync control can never drift. Each redacted reason goes in a `<Code>`
inside the body.

### 4. The one sync control

**When everything is fine it renders nothing.** No placeholder, no grey
icon, no empty slot. The topbar has one fewer control than it does today
until something is wrong.

**When something is wrong** one `ActionIcon` appears between the theme
toggle and the account menu (`web/src/shell/Topbar.tsx:128-129`):
`IconAlertTriangle` in the warning colour. On a wide screen it carries a
short label too, using the exact `visibleFrom`/`hiddenFrom` pair the
search button already uses on `layoutBreakpoints.compactTopbar`
(`Topbar.tsx:93-113`). No new breakpoint and no pixel width.

**It speaks for the current file, not only for the project.** When
`isUnsynced(currentDoc)` is true its accessible name is "This note has
not reached the remote", otherwise it is the state's title. It asks
about `currentDoc` and never about `currentPath`, which is the whole
point of section 3's registration: on `/p/` and `/p/notes/` the route
path is not the file, and the root index is the page most readers are
looking at. That is what makes the per-file requirement survive on a
phone with the drawer shut, and it is why this one control replaces the
three per-page badges the earlier draft put in the topbar actions slot.

**Clicking it opens a Mantine `Popover`** holding the same
`syncMessage()` title and body as the banner, the "this note" sentence
first when it applies, and the unsynced paths when there are at most a
handful, and nothing but the message when `many` is set. One function
feeds both surfaces, so there is one set of words to maintain.

**A path in the popover is a link the same way a directory row is.** The
set holds attachments too, and a non-markdown path is served by `/raw/`,
which is outside the router and has no shell
(`server/spa.go:148`, `server/handlers.go:113-145`). A router `<Link>`
to it would change the address bar and never reach the raw handler. So
the popover asks the same `isMarkdown` question the locked design
already makes `DirectoryView` ask
(`docs/plans/20260914-multi-source-repos.md:1208-1218`): markdown gets
`<Link to={documentUrl(path)}>`, everything else gets
`<a href={rawUrl(path)}>`. Deleted markdown is fine either way - it
lands on the missing-document screen, which carries its own badge.

**Why both a control and a banner.** They do different jobs. The banner
sits above the outlet inside `AppShell.Main`, which scrolls, so on a long
note it is gone. The header does not scroll
(`AppLayout.tsx:112-149`). The banner explains; the control persists.
Neither is redundant and they share their words.

**Several projects.** The control speaks for the project the reader is
in, and only that one, as the Problem section states. `/api/me` is per
project by construction and `/api/projects` is locked immutable. A broken
project is announced the moment the reader switches to it, which is a
full page load that boots the shell and fetches `/api/me` for the new
project. See "Not covered" for why cross-project alerting is cut rather
than deferred.

### 5. How the client learns the state changed

This is the hole most likely to sink the feature, so the answer is spelt
out in full. Three things change the state, and they need different
answers:

| what changes it | who caused it | answer |
| --- | --- | --- |
| a save whose push failed | the reader, just now | the mutation response |
| a background `Sync` that failed | nobody | the poll |
| a background `Sync` that succeeded | nobody | the poll |

**A mutation response is not enough**, because two of the three happen
with no request in flight. **Navigation is not enough** either: the
person who is looking at the editor and nothing else navigates nothing
for twenty minutes, which is precisely the case the user described. So
the design needs something that runs without the reader, and that is a
poll.

**(a) `refresh()` splits in two.** Today one function bumps one token and
refetches `nav` and `me` together (`NavContext.tsx:71-73`, `:116`), and
both go through `useApi`, which clears its data first. So a failed save
that wanted to refresh `me` would empty the sidebar for a round trip.
`NavState` publishes two functions instead:

- `refreshNav()` - the tree changed. `FileActions` keeps calling it after
  create, rename and delete (`FileActions.tsx:96`, `:138`, `:154`).
- `refreshMe()` - the project state may have changed. Cheap, and it never
  blanks anything, because `me` no longer lives in `useApi`.

**`refreshMe` has one owner, the mutation hook below.** `FileActions`
does not call it: create, rename and delete are three of the five locked
`MutationState` call sites
(`docs/plans/20260914-multi-source-repos.md:1252-1257`), so the hook
already refreshes `me` for them. Asking for both there would send two
`/api/me` requests for one delete.

**(b) Mutation feedback becomes a hook.** The locked helper beside
`showToast` stays what it is, a pure function from `MutationState` to a
toast, because `web/src/toast.ts:12` is module level and cannot read
React context. Over it sits one hook in the shell:

```ts
function useMutationState(): (state: MutationState) => void
```

which calls the locked helper and then `refreshMe()` - **always, not only
when the state is dirty**. Refreshing only on a dirty response was the
earlier draft's mistake: a successful save that finally pushed would
leave the previous warning standing until the next tick. The five locked
call sites use the hook instead of the bare helper. Latency for the
reader's own state change, in either direction: one round trip, and the
toast has already told them.

**Two more editor paths have to be covered, and neither is one of the
five.** Both are in `EditorScreen`:

- *Save as a copy.* `saveCopy` throws the response away and navigates
  (`EditorScreen.tsx:290-294`), and navigation deliberately does not
  refresh `me`. A conflict copy is a save like any other and its push
  can fail like any other, so the response goes to the hook before the
  `navigate`. The toast survives the navigation because `showToast` is
  module level (`web/src/toast.ts:12`), and so does `refreshMe`, because
  `NavProvider` sits above the router.
- *A response lost on the way back.* The conflict branch recognizes that
  the write in fact went through, and says "Saved"
  (`EditorScreen.tsx:329-333`). There is no `MutationState` to hand the
  hook: the response that carried it never arrived, and `api.file` does
  not carry one. So this branch calls `refreshMe()` directly. It is the
  single place outside the hook that does, and the reason is exactly
  that it is the single successful write with no response of its own.

**(c) A poll of `/api/me`, and only `/api/me`.** It cannot go on the
existing `useApi` call, because `useApi` clears `data` before every
request (`web/src/api/useApi.ts:23`) and `canWrite` requires `me` to be
defined (`NavContext.tsx:127`), so an interval there would flash every
write control and every badge off once a tick. So `me` moves out of
`useApi` into a small hook in `NavContext.tsx`:

```ts
function useMe(): { me: MeResponse | undefined; refreshMe: () => void }
```

which holds the last good response and **never replaces it with
undefined**. It fetches on mount, on `refreshMe()`, on an interval of
`meRefreshMs = 60_000`, and once on `visibilitychange` to visible. It
skips the tick while `document.hidden`, so a tab left open all night
polls nothing.

**The requests are ordered, or the newest one loses.** Interval,
visibility, mutation and mount requests can overlap, and an older clean
response arriving after a newer failed one would erase the warning. So
`useMe` keeps one generation counter: every start increments it, aborts
the request in flight through the signal `call` already accepts
(`web/src/api/client.ts:128`, `:140-146`), and a response is applied only
if its generation is still the current one. This is four lines and it is
the difference between a state that settles and one that flickers.

**`currentPath` is not a dependency.** The earlier draft refreshed `me`
on every navigation to match the `nav` call. Cut: `/api/me` is
path-independent, the editor already fetches its own `me`
(`web/src/pages/EditPage.tsx:19-23`), and one fewer trigger is one fewer
race to order. The poll and the mutation hook cover everything.

**The polled request is quiet, and it is background.** Two flags on
`call`, both client-only in effect:

- *quiet*: skip `notifyUnauthorized` (`client.ts:89-92`, `:148-150`).
  Without it a poll that met an expired session would open the editor's
  session-expiry modal with nobody touching anything, which breaks the
  "nothing modal" rule of section 6 for a state the next real request
  reports anyway.
- *background*: send `X-Scrawl-Background: 1`.

**What the background header is for, and why a client may set it.**
`Middleware` reissues the session cookie once less than half the TTL is
left (`auth/auth.go:219-225`). A tab polling once a minute would
therefore keep an unattended session alive forever, which is a real
change to how long a session lives and is not something a UI feature gets
to do silently. So `auth` gains a predicate beside `wantsJSON`
(`auth/request.go:84-89`) and one condition in `Middleware`:

```go
func background(r *http.Request) bool {
    return r.Header.Get("X-Scrawl-Background") == "1"
}

// ...
if !background(r) && tok.expiry.Sub(s.now()) < s.ttl/2 {
    s.issue(w, r, tok.user)
}
```

The header is set by the client and trusted, and that is safe here in one
direction only: it can **shorten** the life of a session and never extend
one. A caller who sets it on every request simply gets no sliding
renewal; a caller who never sets it gets exactly today's behaviour.
Nothing about authentication or authorization depends on it. It is worth
being explicit about that, so the next reader does not "fix" it into a
server-side guess based on the path, which would get the editor's own
`me` request wrong.

`TestServiceMiddlewareSlidingRenewal` (`auth/auth_test.go:363-390`) gains
one case: past half the TTL, with the header, not renewed.

**Latency.** Up to 60 seconds for a change nobody caused, one round trip
for a change the reader caused. Since the server-side rhythm is the
`pull` interval - 5m in the config example, 1h in the webhook recipe - a
60 second client poll is already finer than the state it is watching.

**What was rejected.** Server-sent events or a websocket: a connection
per tab, a reconnect policy and a new route, to improve a latency that is
already finer than the thing being watched. Piggybacking on the mutation
responses alone: it cannot report a change nobody caused, which is half
the requirement. Polling the tree as well: a full `Store.Tree()` walk per
tick per tab, avoided entirely by putting the path set in `/api/me`
instead of on the nodes.

### 6. Non-blocking, but not a surprise

The rules, and where each is enforced:

- **Nothing modal.** No `Modal`, no confirm, nothing that takes focus.
  The one modal that can appear without a click is the session-expiry
  dialog, and the poll's quiet mode above is what keeps it from firing on
  a timer.
- **Nothing disables editing.** `canWrite` is derived from `read_only`
  and the session (`NavContext.tsx:127`) and no sync state touches it. A
  project that cannot push is a project that still saves.
- **Amber, never red.** Every state in section 2 is `color="yellow"` on
  the alert and `--scrawl-warning` on the badge. Red stays what it is
  today: a request that failed in front of the reader
  (`web/src/toast.ts:10`). Nothing here has failed in front of them -
  the save landed, the note is on disk, the history entry exists.
- **No toast that must be dismissed.** The locked `MutationState` toast
  keeps Mantine's default auto-close and never sets `autoClose: false`
  or a required close button. The persistent statement is the banner's
  job, which is why the toast is allowed to be transient.
- **Nothing is dismissible either.** The banner has no close button: a
  state that is still true should not be hideable, and the alternative -
  remembering a dismissal - would mean a reader who dismissed once never
  hears about the next failure.

**How the first failed push reaches someone who is looking at the editor
and nothing else.** Three things, in this order, from one save:

1. The save's response carries `MutationState` with `unpublished` set.
   The locked helper shows an amber toast - "Saved here, not pushed to
   the remote" - which auto-closes and blocks no keystroke.
2. The same hook calls `refreshMe()`. Within one round trip the sync
   control appears in the fixed header, and because the note being edited
   is in the set, it says so by name.
3. The banner is above the outlet, so it is there the moment they scroll
   up or navigate anywhere.

The transient tells them now; the two persistent surfaces are still there
in an hour. Nothing at any step interrupts typing.

### 7. Accessibility and theming

- **A state is never carried by colour alone.** Every surface pairs the
  colour with a glyph and with words: the badge is an icon plus hidden
  text, the control is an icon with an accessible name and, above
  `compactTopbar`, a visible label, and the alert has an icon, a title
  and a body.
- **The badge is an `aria-hidden` icon plus `VisuallyHidden` text**, the
  pattern the editor's layout control already uses
  (`EditorScreen.tsx:437-446`). The earlier draft put an `aria-label` on
  a bare `<svg>` inside a `Tooltip` and claimed Mantine would open the
  tooltip on keyboard focus: it cannot, because an `<svg>` is not
  focusable, and an `aria-label` on an element with no role is not
  reliably announced. The hidden text carries the meaning; the tooltip is
  optional decoration on a pointer.
- **What a screen reader gets.** `ProjectAlerts` keeps a container with
  `role="status"` and `aria-live="polite"` **mounted at all times**, even
  when it is empty. A live region inserted into the DOM at the same
  moment as its text is unreliably announced; one that is already there
  announces the insertion. Polite and not assertive, because nothing here
  is an emergency and an interruption mid-sentence is exactly the
  surprise the design is trying to avoid. A poll that returns the same
  state renders the same string and says nothing.
- **The badge reads in place.** "guide, not pushed to the remote" for a
  tree row, because the hidden text sits next to the link and not inside
  it.
- **Both colour schemes come from the theme.** `--scrawl-warning` is
  defined in `lightTokens` and `darkTokens` (`web/src/theme.ts:108`,
  `:128`) and published by `cssVariablesResolver` (`:184-196`); the alert
  uses Mantine's `color="yellow"`, which is what the existing warning
  already uses (`HistoryPage.tsx:316`). No new token, no rule defined
  only inside a media query.
- **No decorative hover anywhere in this feature.** The badge is not
  interactive and gets no hover styling, which sidesteps the
  `@media (hover: hover)` rule rather than having to satisfy it. The
  control is a Mantine `ActionIcon` and inherits the project's existing
  treatment.
- **Breakpoints come from the theme only.** The single responsive
  decision, whether the control shows its label, reuses
  `layoutBreakpoints.compactTopbar` (`web/src/theme.ts:49-57`) through
  `visibleFrom`/`hiddenFrom`. No component reads `window.innerWidth` and
  no pixel width is written down.
- **No bare ids.** Every piece of this feature is a Mantine component
  rendered in place, or through the shell's existing portal refs
  (`ShellSlots.tsx:24-27`), and nothing is looked up by element id, so a
  note with a heading called "Sync" cannot collide with any of it.

### 8. Mobile

The sidebar is a drawer below `layoutBreakpoints.sidebar`
(`AppLayout.tsx:163-185`), so a tree badge is invisible with the drawer
closed. A phone gets the state from two surfaces that do not live in the
drawer:

1. **The sync control.** The header is fixed and rendered at every width;
   only its text label is hidden below `compactTopbar`, never the icon.
   Its accessible name says whether the note on screen is one of the
   affected ones, and tapping it opens the popover with the full message
   and the paths.
2. **The banner**, above the outlet in `AppShell.Main`, at every width.

Plus the in-body badges - search results, directory rows, the
missing-document heading - which are body content and are as visible on a
phone as anywhere.

**On a phone the current-file signal is the control, and nothing else.**
The tree is behind a closed drawer and the document body carries no
badge, so the control is the one surface that answers "is *this* note at
risk". That is why it asks `currentDoc`: on the home screen, which is
the root `index.md` served under `/p/`, a control that asked the route
path would stay silent about the very note on screen. The same holds for
any folder with an index. The mobile spec covers both.

**The header budget is one element, and it is checked.** This feature
adds exactly one node to a `nowrap` row that is already full
(`Topbar.tsx:55`). The two checks it has to pass live in two existing
tests, not one: `expectNoHorizontalScroll` over a list of routes
(`e2e/tests/mobile.spec.js:176-192`) and the tap-target minimum for
`[data-testid=topbar] button, [data-testid=topbar] a`
(`e2e/tests/mobile.spec.js:222-228`). The sync spec drives the topbar
into its worst case - a document page, with page actions, with the
control up - and runs both. Nothing in this design is desktop-only, and
nothing in it is allowed to push the header past the viewport.

## Key decisions

**The path set rides on `/api/me`, not on the tree nodes.** The obvious
shape is a flag on `navNode`, `DirEntry`, the search hits and
`pageResponse`. It was rejected on the refresh path: a badge that lives
on the tree can only be refreshed by refetching the tree, which is a full
`Store.Tree()` walk (`server/page.go:110-130`) per tick per open tab.
Putting the set in `/api/me` means one small endpoint carries every
surface's answer, the poll is one cheap request, and four existing
payloads are untouched.

**The visibility filter lives in `history` and runs before the cap.** The
earlier draft filtered in `apiMe`, after `history` had capped. That is a
correctness bug - hidden files can spend the cap and suppress a real
badge - and it puts a component walk with an `Lstat` per component
(`store/store.go:632-658`) on a polled endpoint. One optional predicate
in `history.Config`, beside the `Files` callback that is already there,
fixes both.

**`unpublished` stays the count; the path set is a second, conditional
measurement.** Replacing `rev-list --count` with the diff would have been
one command instead of two, and it was rejected because `unpublished` is
locked and because the two answers are not identical: a commit that
changes nothing net is ahead by a commit and empty by a diff. Keeping
both means the locked flag keeps its exact meaning for the mutation
responses, the UI keys off the set, and the second command runs only when
the first says we are ahead.

**One snapshot, swapped once per attempt.** The three values are
published together when the attempt ends. This is what lets section 2
delete a whole state instead of describing it.

**And read back in one load.** Publishing them together buys nothing if
`/api/me` reads them one getter at a time, which is how `apiMe`
assembles its response today (`server/spa.go:267-280`): a `Sync` landing
between two calls pairs an old error with a new path set, and the poll
keeps that impossible state on screen for a minute. `SyncState()` is one
accessor for the whole snapshot and `apiMe` calls it once. The locked
`Unpublished()` and `SyncError()` are untouched and stay where the
multi-source design uses them.

**The current file is the document path, not the route.** A directory
with an `index.md` is served under the directory's address, the root
included, so the route says `""` where the file is `index.md`. Testing
the route path would have left the app's most visited page with no
per-file signal, and on a phone, where the tree sits behind a closed
drawer, the control is the only place that signal can appear.
`DocumentBody` registers `doc.doc_path` and the control asks that. The
alternative, a badge in the document body, was rejected: it puts the
answer in the one place that scrolls away, and it still leaves the
control saying the wrong thing.

**A path in the popover follows the locked link split.** Markdown is a
router `<Link>`, an attachment is a physical `<a href={rawUrl(path)}>`,
because `/raw/` is outside the router. This is the same rule the locked
design already applies to a directory row, asked with the same
`isMarkdown`.

**Above the cap the list is dropped, not truncated.** A list of the first
200 of two thousand would put a badge on 200 notes and nothing on the
other 1800, and the absence of a badge would read as "this one is fine".
That is worse than saying nothing about individual files. The degraded
form is a different sentence, not a shorter list.

**No counts.** An exact number forces the whole diff to be read and
counted past the cap, and it buys a digit nobody acts on. "Some notes"
and "many files" are the two forms.

**One alert, titled by precedence, bodied by both facts.** A stack of
alerts above every screen was rejected: it is the loudest possible answer
to a requirement that says non-blocking. Composing the two bodies costs
one paragraph and keeps the exact git reason for the remote failure,
which is the part a reader can act on.

**`waiting` is cut.** Ahead with nothing failed is not a state a browser
can usefully catch once the snapshot swaps once per attempt, and startup
syncs before it serves. Keeping it would have meant a badge that appears
during a healthy push and lingers a minute after it succeeds.

**Per-file badges never go in the topbar.** The earlier draft put one in
the document header, one in the editor header and one in the history
page's action group - all three the same portal slot, in a `nowrap` row
that is already full on a phone. One control that names the current file
says the same thing in one element.

**A 60 second poll, not a socket and not navigation.** A socket is a
connection per tab, a reconnect policy and a new route, to beat a latency
that is already finer than the `pull` interval it watches. Navigation
does not run when the reader is in the editor, which is the exact case
the user named.

**The poll refreshes after every mutation, not only after a dirty one.**
Refreshing only on a dirty response cannot clear a warning that a
successful save has just made false.

**One owner for `refreshMe`.** The mutation hook does it for every
response that carries a `MutationState`, the conflict copy included.
`FileActions` asks only for `refreshNav`, because its three writes are
already three of the five hook call sites. The one exception is the
editor's recovered lost response, which is a successful write with no
response to hand the hook.

**The poll is quiet about 401 and marked background.** Quiet keeps the
rule that nothing modal appears without the reader doing something.
Background keeps a timer from silently converting a 96-hour session into
an unbounded one; the marker is client-set on purpose, because it can
only shorten a session.

**No "retry now" button.** It needs a new authenticated endpoint to
trigger `Sync`, and it buys latency only: every save already pushes, the
ticker already retries where there is one, and the webhook already exists
for a project that wants a push-triggered refresh. Cut.

**No cross-project badge in the switcher.** `/api/projects` is locked as
immutable data that reads no store, and the alternative is a new global
endpoint that asks every project's history for its state - which is the
one thing the global/project boundary was drawn to prevent. A broken
project announces itself the moment the reader opens it. Named as not
covered rather than smuggled in.

**No document title prefix and no browser notification.** Both reach a
reader in another tab, and both are the kind of ambient alarm that a
notes app has no business raising for a state that retries itself.

## Risks / open questions

- **`unpublished` can be true with an empty path set.** A commit that
  changes nothing net leaves `rev-list --count` above zero forever while
  the diff is empty. The UI keys badges off the path set and the alert
  off the error, never off bare `unpublished`, so this shows nothing
  rather than lighting a marker that points at no file. The locked flag
  keeps its meaning on the mutation responses, where it is the honest
  answer. Worth one test.
- **The three-dot diff needs `origin/<branch>` to exist.** Same
  dependency the locked `unpublished` measurement has: a clone always
  leaves the ref behind, and a first fetch that fails leaves both
  measurements as they were with `syncError` carrying the truth. Nothing
  new, but it means "not pushed" and "cannot reach the remote" remain two
  sentences.
- **The diff repeats while a project stays broken.** Once per failed save
  and once per tick, buffered up to 32 MiB by `run`. Bounded and only on
  a broken project, but it is not the one-off the earlier draft implied.
  If a large corpus makes it show up, the fix is to stream the output,
  not to cache the answer.
- **`Visible` is asked once per changed path per measurement.** With the
  predicate in `history` this is off the request path entirely, but a
  measurement that follows a 5000-file import still does 5000 component
  walks with an `Lstat` each (`store/store.go:632-658`). Measure it once
  on the example corpus rather than assuming.
- **A deleted attachment in the popover is a dead link.** The set is a
  diff, so it holds deletions, and nothing in `/api/me` says which paths
  still exist: `Store.Visible` answers about policy, not about the entry
  being there (`store/store.go:182-189`), which is exactly why a deleted
  note still gets its badge on the missing-document screen. So showing
  deleted attachment paths as plain text is not implementable as it
  stands: the client cannot tell the two apart. A deleted
  markdown path lands on the missing-document screen, which is correct;
  a deleted attachment lands on the raw handler's plain 404, which is a
  dead end the back button leaves. Carrying an existence bit was
  rejected: it is a `Stat` per path in the measurement and a second
  meaning in the payload, to turn one rare dead link into plain text.
- **The background header is trusted.** Section 5 argues it is safe
  because it can only shorten a session. If a later change gives the
  header any other meaning, that argument stops holding and the header
  has to go.
- **The poll makes session expiry detectable without an action.** The
  quiet mode keeps it from opening a dialog, so an expired session is
  still discovered by the next real request, which is today's behaviour.
  Confirm once through the editor flow that a draft is still flushed on
  the eventual 401 (`EditorScreen.tsx:342-345`).
- **`currentDoc` lags the navigation by one fetch.** The document
  registers itself when it renders, so between a navigation and the page
  response the control speaks for the project and not yet for the note.
  It settles in one round trip and the badge on the tree row is already
  right, so this is accepted rather than pre-registered from the route.
  It also costs one extra render of the shell per navigation, because a
  child writes state the provider holds.
- **Moving `me` out of `useApi` touches `canWrite`.** `useMe` must never
  hand back undefined after the first success, or every write control
  flashes off once a minute. The regression test is in the browser suite,
  not a unit test; see the outline.
- **A first import puts a badge on nothing.** The baseline `Reconcile`
  commits the whole corpus, so the first measurement is almost always
  above the cap and the reader gets "many files" once, on a project that
  is working correctly and simply has not finished its first push. That
  is honest, it clears on the first successful push, and it is worth a
  line in the README so nobody reads it as breakage.
- **The badge is only as fresh as the poll on a screen nobody touches.**
  A note pushed successfully in the background keeps its badge for up to
  a minute. Accepted: the failure direction is the one that matters and
  it is one round trip when the reader caused it.
- **A diverged project shows badges that will never clear on their own.**
  That is correct and it is the point, but it means a project left
  diverged wears an amber header indefinitely. The message names the fix
  and the fix is manual by design.

## Not covered

- **Another project being broken.** The control speaks for the current
  project only, as the Problem section states.
- **Anything outside the app shell.** `/raw/` has no chrome; a directory
  row is where an attachment is marked.
- **Being behind the remote.** Section 5b: after a successful fetch this
  copy is never behind except when diverged, which is covered; the
  missed-fetch case is what the safety-net poll is for.
- **Which commit a file is unpushed in**, or any per-file publication
  history. The set is a set.
- **Which unsynced paths still exist on disk.** The set does not say, and
  the popover does not pretend to.
- **Conflict resolution.** Locked out by the multi-source design;
  divergence is a loud state with a manual fix.
- **A retry control.** Every save pushes and the ticker retries.
- **Per-file badges above 200 unpushed files.**
- **Any alert outside the tab**: no title prefix, no browser
  notification, no email.
- **A history of past failures.** The state is what is true now; the log
  is where the sequence lives.
- **A frontend unit test stack.** `web/package.json` has no test runner
  and this feature is not the reason to add one.

## Implementation outline

Each step leaves the tree building and the tests green. It all lands
after the multi-source design, because every piece names a type from it.

1. **`history`: measure the path set.**
   Add `Unsynced`, `SyncState`, `Service.SyncState()` and
   `Config.Visible`. The snapshot holds `syncError`, `unpublished` and
   the path set behind one `atomic.Pointer`, published once per attempt
   and read back in one load; `Unpublished()` and `SyncError()` keep
   their locked shape and read the same pointer. Run
   `git diff --name-only -z origin/<branch>...HEAD` through the existing
   `run` with `limit: maxListBytes` (`history/git.go:14-20`), only when
   the `rev-list` count is non-zero, at the measurement points the locked
   table names. Filter with `Visible`, then cap at `unsyncedCap = 200`,
   dropping the list and setting `Many` above it. A nil `*Service`
   answers the zero value.
   Tests, against a bare repository in a second temp directory the way
   `serviceAt` already does (`history/history_test.go:83-97`): a failed
   push listing exactly the paths it touched; a successful push clearing
   the set; a diverged branch listing only this side's paths and not the
   remote's, which is what the three-dot form buys; a hidden path never
   reaching the set; 201 hidden paths plus one visible path still
   yielding that one path and not `Many`, which is the ordering bug;
   more than 200 visible paths giving `Many` with an empty list; a clean
   project running no diff at all; `SyncState()` answering an error and
   a path set that belong to the same attempt.

2. **`server`: put it on `/api/me`.**
   `SyncState()` on the `History` interface (`server/history.go:20-29`)
   and on `fakeHistory` (`server/history_test.go:29-92`). Wire
   `Config.Visible` to `prj.Store.Visible` where the project builds its
   history. The `unsynced` object inside the `project` object of
   `meResponse` (`server/spa.go:96-105`, `:267-280`), filled from one
   `SyncState()` call together with `unpublished` and `sync_error`.
   `Cache-Control: private, no-store` on `apiMe`.
   Tests: the set passes through unchanged; a project with no history
   answers an empty set; `many` passes through; the response carries
   `no-store`; `apiMe` asks the history for its state once, which a
   counting `fakeHistory` can assert.

3. **`auth`: no sliding renewal for a background request.**
   `background(r)` beside `wantsJSON` (`auth/request.go:84-89`) and one
   condition in `Middleware` (`auth/auth.go:219-225`). One case added to
   `TestServiceMiddlewareSlidingRenewal` (`auth/auth_test.go:363-390`):
   past half the TTL, header set, no cookie reissued. One line in the
   `Middleware` doc comment saying the marker can only shorten a session.

4. **`client`: the state, the predicate and the refresh path.**
   `MeResponse.project.unsynced` in `web/src/api/types.ts:111-119`.
   `syncMessage(me)` resolving section 2's precedence and composition, in
   one module beside `ProjectAlerts`. `useMe()` in
   `web/src/shell/NavContext.tsx`, replacing the `useApi` call at `:73`:
   last-good value, generation counter with abort, interval of
   `meRefreshMs = 60_000`, skipped while `document.hidden`, refetched on
   `visibilitychange`, quiet and background through two new options on
   `call` (`web/src/api/client.ts:89-92`, `:128-159`). `refreshNav` and
   `refreshMe` replace `refresh` on `NavState` (`NavContext.tsx:33-46`,
   `:116`), with `FileActions` calling `refreshNav` only
   (`FileActions.tsx:96`, `:138`, `:154`). `sync`, `isUnsynced` and
   `currentDoc` on `NavState`, plus the `useCurrentDoc(docPath)` hook
   that writes it, called from `DocumentBody` (`DocumentBody.tsx:18-21`)
   with `doc.doc_path` and from nowhere else.
   `useMutationState()` wrapping the locked toast helper and always
   calling `refreshMe`, used at the five locked call sites and at
   `saveCopy` (`EditorScreen.tsx:290-294`), which stops discarding its
   response; `refreshMe()` called directly in the recovered-lost-response
   branch (`EditorScreen.tsx:329-333`), which has no response to pass.

5. **`client`: the surfaces.**
   `SyncBadge` (an `aria-hidden` `IconCloudUp` plus `VisuallyHidden`
   text), used in `SidebarNav` between the `Anchor` and the `RowMenu`
   (`web/src/shell/SidebarNav.tsx:109`), in `DirectoryView` as a third
   cell (`web/src/components/DirectoryView.tsx:38-54`), beside the search
   result link (`web/src/pages/SearchPage.tsx:50-64`) and next to the
   missing-document title (`web/src/components/DocumentView.tsx:23-30`).
   `SyncControl` in `Topbar` between `ThemeToggle` and `AccountMenu`
   (`web/src/shell/Topbar.tsx:128-129`), rendering nothing when
   `syncMessage` is undefined, naming the current file when
   `isUnsynced(currentDoc)`, with the `visibleFrom`/`hiddenFrom` label
   pair on `layoutBreakpoints.compactTopbar`. Its popover lists the paths
   with the locked link split: `<Link to={documentUrl(path)}>` for
   markdown, `<a href={rawUrl(path)}>` for everything else, asked with
   `isMarkdown` (`web/src/paths.ts:36-38`).
   `ProjectAlerts` renders `syncMessage` in one `color="yellow"` Alert
   inside an always-mounted `role="status" aria-live="polite"` container,
   with no close button. `make ui`.

6. **e2e, in the existing Playwright suite.**
   There is no frontend test runner and this feature does not add one, so
   the client behaviours are asserted in the browser.
   - *Failure, live.* On the remote instance with a local bare origin:
     break the origin (move it aside), save a note, and assert the amber
     toast, the sync control, the banner and the badge on that note's
     tree row and search row without a reload.
   - *Recovery, live.* Restoring the origin changes nothing by itself:
     `/api/me` only reads fields (`server/spa.go:267-280`) and the client
     poll does not trigger a `Sync`. So the test instance runs with a
     short `pull` interval, or the spec fires the project's webhook, and
     only then waits one client poll - driven by `page.clock` rather than
     a real minute. Assert all four are gone without a reload.
   - *Recovery, reader-driven.* Separately: restore the origin, save
     again, and assert the state clears from the mutation path alone.
     This is what catches "refresh only when the response is dirty".
   - *A conflict copy is a save too.* With the origin broken, take the
     conflict dialog's "save as a copy" branch and assert the control and
     the banner are up on the copy's editor page without a reload. This
     is what catches a response thrown away before a navigation.
   - *An index note is the current file.* With the origin broken, save
     the root `index.md`, go to `/p/`, and assert the control names the
     note and not the project. The same on a folder with an index, at
     `/p/<folder>/`. Without the registration of section 3 both say only
     the project title, which is the hole this catches.
   - *No blanking.* With `page.route` delaying `/api/me`, advance the
     clock past two ticks and assert the sidebar, the write controls and
     the badges never disappear.
   - *Quiet 401.* Intercept a poll with a 401 and assert no dialog opens.
   - *Mobile.* One phone-width spec with the drawer closed, asserting the
     control and the banner on a plain note, on the root index at `/p/`
     and on a folder index, and reusing the two existing checks -
     `expectNoHorizontalScroll` (`e2e/tests/mobile.spec.js:176-192`) and
     the topbar tap-target minimum (`:222-228`) - with the control up.

7. **Documentation.**
   README: what the amber control means, that editing is never blocked,
   that a first import shows "many files" once, and that a diverged
   project needs the command the message carries. CLAUDE.md: one rule
   saying the sync state reaches the client only through `/api/me`, read
   in one load so an error and a path set always belong to the same
   attempt; that the path set is measured and filtered in the same breath
   as `unpublished` and dropped above its cap; that one alert is titled
   by precedence and carries both facts; that the client polls `me`
   quietly and in the background rather than refetching the tree; and
   that the file on screen is `doc_path`, not the route, because a
   directory index is served under the directory's address.

8. **`make lint`, `make race`, `make e2e`.**
