# A webhook that refreshes a remote project

## Problem

A remote project is refreshed by polling. `history.Remote.PullEvery` sets
the interval, a ticker in `main` calls `Sync`, and the clone is stale for
up to one interval after somebody pushes upstream. Shortening the
interval makes the lag smaller and the number of pointless fetches
larger.

The wanted alternative is a webhook: the upstream repository posts to
scrawl when something is pushed, scrawl runs the same `Sync` it already
runs, and no polling is needed. It has to be optional, and the operator
has to be able to choose which mechanism a project uses.

Everything about projects, remotes, `Sync`, credentials and the URL space
comes from `docs/plans/20260914-multi-source-repos.md` and is not
reopened here. This document adds one endpoint, one verifier and one
trigger channel. `history` is not touched at all.

## Context

This builds on the multi-source design, and depends on these parts of it.
They do not exist in the tree yet.

- **`server.Project`**, the per-project bundle with `Name`, `Store`,
  `History` and `Prefix() = "/p/" + Name`, and the `mount{*Web, prj}`
  receiver every project handler moves onto. Routes for one project are
  registered by `projectRoutes(g, prj)` under that prefix.
- **The per-mount catch-alls**, registered last in `projectRoutes`:
  `GET <prefix>/api/{path...}` for a JSON 404 and
  `GET <prefix>/{path...}` for the app shell. Section 3 shows why the
  second one decides how the hook route is spelled.
- **`main.runtimeProject`**, the wrapper holding the concrete
  `*store.Store`, `*history.Service`, the `*history.Remote` and the pull
  interval. Closing, watching and syncing are `main`'s job.
- **`history.Service.Sync`**, which is `git fetch --prune`, then
  `git merge --ff-only`, then a push unless the project is `PullOnly`. It
  takes `s.mu`, the same mutex `Record` holds
  (`history/history.go:102-107`, `history/write.go:56-57`), so a sync and
  a save never interleave. Every git call is bounded by a timeout,
  10s by default (`history/history.go:44`, `history/git.go:44-50`).
- **`resolveToken(file, envVar)` in `main`**, the one credential reader:
  at most one of the two sources, read once, one trailing newline
  stripped, any other control character refused. It runs while the config
  is parsed, before `setupLog` (`main.go:107-119`), and its result joins
  `secretsOf` (`main.go:496-511`) and is unset from the environment. It
  deliberately allows an empty result, because a public https remote
  needs no credential. That is right for a git token and wrong for a
  hook secret; section 2 says what the difference costs.
- **Validation is two-phase**: a syntactic phase over the config text,
  the environment and the secret files, then the clone, then a canonical
  phase over resolved paths. The canonical phase is where the session key
  file is required to live outside every project root.
- **`unpublished` is measured, not remembered**, and `syncError` carries
  the last failed conversation with the remote. Both are already
  surfaced.

What the existing tree gives us:

- **The middleware stack** is installed once on the root bundle
  (`server/server.go:224-238`): trace, recoverer, security headers, gzip,
  `rest.Throttle(64)` (`server/server.go:35`, `:233`), the request logger,
  `auth.Middleware` and `appInfo`. Every route, project or global, runs
  under all of it.
- **CSRF is not a middleware on everything.** `auth.CSRF()` is applied to
  the `mutating` sub-group only (`server/server.go:281-292`), so a route
  registered outside that group carries no cross-origin check.
- **`auth.Middleware` answers a Bearer credential first**
  (`auth/auth.go:210-218`), then a session, then `isPublic`
  (`auth/auth.go:228`). A request with no `Authorization` header and no
  cookie reaches `isPublic`, which is the branch a webhook needs.
- **`isPublic` is prefix matching, and that is the trap.**
  `hasPathPrefix` (`auth/auth.go:322-329`) returns true when the rest of
  the path is empty, starts with `/`, or when the prefix itself ends in
  `/`. So an entry `/p/notes/hook` in that list would also make
  `/p/notes/hook/anything` public, and an entry `/` would make the whole
  server public. The multi-source design already records this and refuses
  to put `/` in the list for the same reason. The list is
  `defaultPublicPrefixes` (`auth/auth.go:74-80`) unless `Config` overrides
  it (`auth/auth.go:94-96`, `:147-150`).
- **The login rate limiter is for logins only.** `Service.Allow`
  (`auth/auth.go:282`) is called from the two login handlers and nowhere
  else (`server/handlers.go:248`, `server/spa.go:291`), so nothing else
  on the server is rate limited.
- **A body cap only bites where the body is read.** `MaxBytesReader`
  wraps the reader (`server/api.go:477`, `server/handlers.go:254`) and
  the error surfaces when the decoder pulls from it. A handler that never
  reads the body gets no `413` out of the wrapper, whatever the cap says.
- **Go's cross-origin protection allows a non-browser POST.**
  `CrossOriginProtection` treats a request with neither `Sec-Fetch-Site`
  nor `Origin` as same-origin or non-browser and allows it
  (`net/http/csrf.go`, the doc comment above `Check`). A provider sends
  neither.
- **The pull ticker is `main`'s**, next to the watcher goroutine whose
  shape it will copy (`main.go:362-394`, awaited at `main.go:241`). That
  shape has a latent deadlock, and section 7 fixes it rather than
  copying it.
- **`rawHandler` serves any visible file** (`server/handlers.go:113`), so
  a file inside a project root is downloadable by anybody who can sign
  in. `checkSecretFile` (`main.go:438-454`) already refuses the session
  key inside the notes root for exactly that reason.
- **The handler tests can already run with auth on.** `newTestServer`
  takes `withAuth` and builds a real `auth.Service`
  (`server/server_test.go:59-108`), and `auth` has a table test for public
  prefixes (`auth/auth_test.go:334-352`).

## Approach

### 1. Two switches, no mode

Nothing new is invented to choose the mechanism. A project already has
`pull`; it gains a hook secret. `pull: 0` turns polling off, a declared
hook secret turns the webhook on, and the four combinations all mean
something:

| `pull` | hook secret | result |
| --- | --- | --- |
| set | absent | today's behaviour |
| set | set | webhook is the fast path, the poll is the safety net |
| `0` | set | webhook only, nothing else fetches |
| `0` | absent | no background refresh, startup `Sync` only |

This follows constraint 1 as given. There is no `mode:` field, because a
mode would have to forbid the second row, which is the row worth
recommending.

### 2. Configuration

The hook secret is spelled exactly like the git credential, and read by
the same helper:

```yaml
projects:
  - name: team
    dir: /data/team
    repo:
      url: https://github.com/acme/wiki.git
      branch: main
      pull: 1h
      hook_secret_file: /run/secrets/gh-hook   # or hook_secret_env: HOOK
```

The single-project flag path reads the fixed variable
`REPO_HOOK_SECRET`, the way it reads `REPO_TOKEN`. There is no flag
carrying the value: a flag lands in `/proc/<pid>/cmdline`, which is world
readable.

`resolveToken` is reused unchanged and renamed `resolveSecret`, because
it now serves two callers and the old name describes only one. The rules
it already enforces are the rules a hook secret needs too: at most one of
the two fields, a named variable that is unset or empty is a startup
error, the fixed variable is optional, one trailing newline is stripped
and any other control character is refused. The value joins `secretsOf`,
so it is redacted out of every log line, and the source variable is unset
after the read.

`history.Remote` does not learn about any of this. The resolved secret
goes to `server.Project`, because the endpoint is the only thing that
uses it.

New validation, in the syntactic phase of the multi-source design:

- a hook secret on a project with no `repo:` is a startup error naming
  the project. There is nothing for a hook to trigger on a local folder,
  and refusing at startup is what makes "the hook fired for a project
  that is not a remote" impossible rather than a runtime branch;
- at most one of `hook_secret_file` and `hook_secret_env`, both is an
  error;
- a named variable that is unset or empty is an error;
- **the resolved secret is at least 32 bytes.** This is the one rule the
  shared resolver must not grow, so it lives beside the call for hooks
  and nowhere else.

**Why the length rule, and why it is not in `resolveSecret`.** The
resolver is allowed to return the empty string, because a public https
remote has no credential and that is a supported deployment. A hook
secret has no such case: the empty string is the HMAC key anybody can
compute with, and the endpoint is reachable without a session, so an
empty or two-character secret turns the route into a public "resync this
project on demand" button, guessable against the 202/401 answer with no
rate limiter in the way (`auth/auth.go:282` is charged from the login
handlers only). The named-variable rule already catches an empty
`hook_secret_env`; it catches neither an empty `hook_secret_file` nor one
holding a single newline, which resolves to the empty string after the
trailing newline is stripped. One post-resolution length check covers all
three and leaves the git resolver alone.

32 bytes, not a format rule and not an entropy estimate: it is the size
of `openssl rand -hex 32` halved, it is what the README will tell the
operator to generate, and anything longer passes. The earlier claim that
the provider generates the secret and so no rule is needed was wrong:
GitHub asks the operator to supply a high-entropy secret, and GitLab
accepts whatever is typed into the field.

**And the secret file lives outside every project root.** The canonical
phase already requires that of the session key file
(`main.go:438-454`, made canonical and made plural by the multi-source
design), and the reason is the same one: a file inside a project is on
the tree, in the index, in every backup of the corpus and downloadable
through `rawHandler` (`server/handlers.go:113`). The check takes the list
of hook secret files as well as the session key, and resolves each
through its **parent** directory the way the session key does, because
`filepath.EvalSymlinks` fails on a path that is not there and a symlinked
parent is how the check is fooled otherwise.

### 3. The route

```
POST /p/<project>/hook   the endpoint
GET  /p/<project>/hook   the same handler, which answers 405
```

It lives under the project subtree because it acts on that project's
clone, which is the question the multi-source design says decides global
versus project: does it touch a store. A global `/hooks/<project>` would
put the project name in a second place and break the rule that a project
is exactly one contiguous subtree.

It is `/hook` and not `/api/hook`. It is not part of the app's JSON API,
nothing in the frontend calls it, and keeping it out of `/api/` keeps the
one public path out of the API subtree, where a later mistake in the
public list would be much more expensive.

**Two registrations with a method each, and not one methodless
registration.** This is a correction: a methodless `/p/<name>/hook`
alongside the locked `GET <prefix>/{path...}` catch-all does not start.
`routegroup` hands both patterns straight to `http.ServeMux`
(`vendor/github.com/go-pkgz/routegroup/group.go:208-231`), and under Go
1.25 (`go.mod:3`) neither pattern is more specific than the other: one
narrows the method, the other narrows the path, so they overlap on
`GET /p/<name>/hook` with no winner. Registration panics, and the message
is explicit about it:

```
pattern "GET /p/team/{path...}" conflicts with pattern "/p/team/hook":
GET /p/team/{path...} matches fewer methods than /p/team/hook,
but has a more general path pattern
```

Registering `POST` and `GET` separately has no such overlap: `POST` meets
nothing, and `GET /p/<name>/hook` is a strict subset of
`GET /p/<name>/{path...}` and wins by being more specific. The three
answers are then:

- `POST` reaches the handler and is verified;
- `GET` (and `HEAD`, which ServeMux routes to the `GET` pattern) reaches
  the same handler, which answers `405`. The registration exists only for
  that: without it a `GET` on a path that is in the public list would
  fall to the catch-all and hand the app shell to an anonymous caller;
- anything else never reaches the handler and gets ServeMux's own `405`
  with an `Allow` header. The status matches what the handler would have
  said, so a caller sees one answer either way.

`server.Project` gains one field:

```go
// server
type Webhook struct {
    Secret string // the shared secret, resolved by main
    Notify func() // non-blocking, asks main to run Sync for this project
}
```

```go
Webhook *Webhook // nil when the project declares no hook secret
```

and one method, so the path has a single home:

```go
func (p *Project) HookPath() string { return p.Prefix() + "/hook" }
```

`main` builds the public list from that method, and `projectRoutes`
registers both patterns from it. A `func()` and not an interface: it is
one call with no arguments and no return. The path is registered only for
a project that declared a secret; for every other project it does not
exist.

### 4. Verification

The handler is the whole security of this endpoint, so it is written as a
closed set of outcomes.

1. `POST` only, otherwise `405`. Nothing below runs.
2. If `X-Hub-Signature-256` is present, it is the GitHub scheme. The
   header is checked for shape **before** the body is touched: the
   `sha256=` prefix and 64 hex characters after it, decoded. A missing
   prefix, bad hex or a wrong length is a rejection that costs no read.
   Then the body is streamed through the cap into the hash,
   `io.Copy(mac, http.MaxBytesReader(w, r.Body, maxHookBody))` over
   `hmac.New(sha256.New, secret)`, and the result is compared with
   `hmac.Equal`. Nothing is buffered, so the memory cost is the hash
   state whatever the cap is.
3. Otherwise, if `X-Gitlab-Token` is present, it is the GitLab scheme:
   `subtle.ConstantTimeCompare` of the header against the secret. The
   body is never read, and therefore never capped and never answered with
   a `413`; Go's server drains what it can and closes the connection
   otherwise, which is the normal behaviour of any handler that ignores a
   body.
4. Otherwise, reject.

Accepted, and this covers GitHub, Gitea and Forgejo through the first
scheme and GitLab through the second. `X-Hub-Signature`, the sha1 form,
is not supported: it is superseded, and supporting it would mean keeping
a broken hash alive for no deployment that cannot send the sha256 one.

Answers: `202 Accepted` with an empty body on success, `401` on any
verification failure with a one-word JSON error, `413` when the body is
over the cap **on the signature branch only**, `405` on the wrong method.
`401` and not `403` because a credential is missing or wrong, and the
provider shows the code in its delivery list.

**The cap is one constant, set to what the providers will actually
send.** `maxHookBody = 25 MiB`. The body is the only part an
unauthenticated caller controls the size of, so it has to be bounded, but
the bound cannot be smaller than a real delivery or the webhook fails
silently for a busy repository and the operator sees `413`s in a delivery
list with nothing wrong on their side. GitHub documents 25 MB as its
payload limit; the exact figure for every supported provider is an item
in "Risks / open questions" to confirm before implementation, and the
only thing that changes is the constant. Streaming is what makes the
number cheap: a rejected delivery costs a bounded read and one sha256
pass, never 25 MiB of held memory.

There is no config option naming the provider. The header already says
which scheme the sender used, and an enum would add a way to configure
the wrong one and get a rejection that looks like a bad secret.

### 5. The body is not read beyond verifying it

**Decision: any verified POST means "something may have changed, run
`Sync`".** No JSON parsing, no event type, no branch filter, no
repository name check, no provider-specific field. The bytes go into a
hash or into nothing at all. A push to a branch we do not track costs one
`git fetch` that finds nothing, and that is cheaper in code and in
failure modes than a payload parser that has to know four providers'
shapes and stay right as they change.

This is also what makes the GitLab scheme work at all: with a plain token
there is nothing signed, so the body could not be trusted even if we
parsed it.

### 6. The request returns immediately

The handler verifies, calls `Notify()` and writes `202`. It never runs
git.

Two reasons, both concrete. A `fetch` is a network round trip to the
provider, and the provider's own delivery timeout is shorter than a slow
one; a delivery that times out is reported as failed and the operator
chases a problem that does not exist. And `Sync` takes `s.mu`, the mutex
that also covers a save (`history/write.go:56-57`), so doing it inside
the request would hold the history lock of a project for the length of
somebody else's network, blocking every save in that window while an
unauthenticated caller holds a slot of the global throttle
(`server/server.go:233`).

### 7. Coalescing: one channel of capacity one

`main` gives every remote project a trigger channel:

```go
// main
trigger chan struct{} // capacity 1

func (rp *runtimeProject) notify() {
    select {
    case rp.trigger <- struct{}{}:
    default: // one pending run already means everything a second would
    }
}
```

and one goroutine per remote project that serves both switches:

```go
func syncLoop(ctx context.Context, rp *runtimeProject,
    run func(context.Context)) {
    var tick <-chan time.Time
    if rp.pull > 0 {
        t := time.NewTicker(rp.pull)
        defer t.Stop()
        tick = t.C
    }
    for {
        select {
        case <-ctx.Done():
            return
        case <-tick:
        case <-rp.trigger:
        }
        if ctx.Err() != nil {
            return
        }
        run(ctx)
    }
}
```

A nil `tick` blocks forever, which is exactly `pull: 0`, so the two
switches need no branch beyond that one `if`. The loop is started when
either switch is on.

**The second `ctx.Err()` is not belt and braces.** `select` picks at
random among ready cases, so a trigger queued at shutdown can win against
a closed `ctx.Done()`. `Sync` then takes `s.mu`, which is a plain
`sync.Mutex` and knows nothing about the context
(`history/write.go:56`), so the shutdown would wait on a save that is
already running before it even reaches the git call that would fail fast.
One comparison removes the whole case.

**Shutdown: the worker context is `main`'s, and it is canceled
unconditionally.** Copying the watcher's current shape would import a
deadlock that is already in the tree. `Web.Run` returns as soon as
`ListenAndServe` fails (`server/server.go:164-171`) while the context it
was given is still live, and `main` then blocks on `<-watchDone`
(`main.go:241`) waiting for a goroutine that only exits when that context
is canceled (`main.go:358`, `store/watch.go:98-106`). A busy listen
address hangs the process today, and a second awaited loop would hang it
twice. So `run` derives one worker context, starts every watcher and sync
loop under it, and cancels it the moment the server returns:

```go
workers, stopWorkers := context.WithCancel(ctx)
done := startWorkers(workers, projects) // watchers and sync loops
runErr := srv.Run(ctx)
stopWorkers()                           // not deferred: a defer fires
for _, ch := range done {               // after the waits below
    <-ch
}
```

`stopWorkers` is called and not deferred, because a `defer` in `run`
would run after the loop that waits, which is the deadlock again.

**Why a goroutine per delivery is wrong.** `Sync` takes the history
mutex. Twenty deliveries in a second would become twenty goroutines
queued on that mutex, each running a full fetch, merge and push in turn,
and every save on that project would wait behind the whole queue. The
work is also identical: the twentieth fetch asks the same question as the
first. A capacity-one channel means at most one `Sync` running and at
most one waiting, which is the smallest state that keeps the guarantee
that matters: a delivery which arrived while a `Sync` was already in
flight still causes another one, because that in-flight fetch may have
started before the push landed.

**No debounce timer.** A burst that arrives while nothing is running can
still produce two runs: the first delivery starts one, the rest collapse
into the single queued slot. The second run is one fetch that finds
nothing. A settle timer would turn that into one run, at the cost of a
timer, a constant and a tunable nobody asked for. Not worth it.

The channel is never closed, so a delivery arriving after shutdown is a
dropped send and not a panic.

### 8. A missed delivery

**A delivery can be lost and the design does nothing to detect it.**
There is no ledger of deliveries, no sequence number, no
`X-GitHub-Delivery` dedup and no catch-up request. With `pull: 0` and a
lost delivery, the clone stays behind until the process restarts, because
nothing else in the design fetches: a save pushes but never fetches, and
the watcher only reconciles. Being behind the remote is also invisible in
the UI - `unpublished` and `sync_error` report being ahead and report a
failed conversation, and neither says stale.

**Recommendation: keep a slow poll on.** The default for `pull` does not
change, and the documented recipe for a webhook project raises it rather
than zeroing it: `pull: 1h` with a hook means deliveries do the work,
almost every tick finds nothing, and a lost delivery costs at most an
hour instead of until the next restart. `pull: 0` stays available and is
the right answer for a project where an hour-old clone is worse than a
pointless fetch is expensive, which is nobody's deployment yet.

### 9. Read-only, pull-only and not-yet-cloned

**A pull-only project is the best case, not a special case.** For a
read-only remote, `Sync` is fetch plus ff-only merge and nothing else,
which is exactly what a hook should trigger for a public repository being
mirrored. Nothing in the trigger path asks about `PullOnly`: the loop
calls the same `Sync` the ticker calls, and `Sync` decides. So the
common public-repository deployment is a hook, `pull: 1h` as the safety
net, `read_only: true`, and no credentials at all - the hook secret is
not a git credential and a public repository still needs one.

**A project that is not a remote cannot have a hook.** It is a startup
error, not a runtime 404 (section 2), so there is no such request to
answer.

**A hook cannot fire before the first clone.** The multi-source design
clones during startup, before the server listens, and a failed clone
stops startup. By the time any route is registered, the clone exists and
`history.New` has adopted it. There is no "not ready yet" state to
represent, and the design does not invent one.

### 10. The auth exception, and how narrow it is

A provider cannot sign in, so the route has to be reachable without a
session. This is a deliberate exception to "write endpoints require auth
and CSRF", and it is bounded on every side:

- **Exactly one path per project**, and only for a project that declared
  a secret.
- **Exact match, not a prefix.** `auth.Config` gains one field beside the
  prefixes:

  ```go
  // PublicPaths are served without a session on an exact match. Unlike
  // PublicPrefixes nothing below them is public.
  PublicPaths []string
  ```

  checked in `isPublic` next to the prefix loop, with a plain `==`. This
  is required rather than nice: putting `/p/notes/hook` in
  `PublicPrefixes` would make `/p/notes/hook/anything` public too
  (`auth/auth.go:322-329`). `PublicPrefixes` stays nil in `main`, so the
  defaults (`auth/auth.go:74-80`) are untouched and this adds to the
  public surface rather than replacing it.
- **`main` builds the list from `Project.HookPath()`**, so the literal
  `/hook` has one home.
- **The bearer branch is not reached.** A provider sends no
  `Authorization` header, so `auth.Middleware` falls through to
  `isPublic` (`auth/auth.go:210-228`). A request that does send a wrong
  Bearer token is still a 401, which is correct.
- **Public means "no session required", never "no credential
  required".** The signature is the credential, the secret behind it is
  at least 32 bytes (section 2), and the handler refuses before it
  touches the project.
- **CSRF: the route is registered outside the `mutating` group**
  (`server/server.go:281-292`). Worth being exact about why, because it
  is not about function: Go's cross-origin protection allows a request
  carrying neither `Sec-Fetch-Site` nor `Origin`, which is every provider
  delivery, so the route would pass the check if it were inside the
  group. It is outside it so that the one route whose authentication is a
  signature does not look like it depends on a browser-shaped check that
  has nothing to say about it.
- **`wantsJSON` needs no change.** It only decides what an
  unauthenticated request is answered with (`auth/request.go:84-89`), and
  a public path is never answered by the middleware at all.

### 11. Wiring order in `main`

The public list is derived from the projects, so the projects have to
exist before `auth` does. Today `auth.NewService` runs first
(`main.go:193`) and the server is built after it (`main.go:218`), so the
order is inverted rather than extended:

1. validate, ensure the directories, clone.
2. build each `runtimeProject`: store, index, history, trigger channel.
3. build the `server.Project` list from them, including `Webhook` with
   `Secret` and `Notify = rp.notify`.
4. collect `HookPath()` from every project that has a `Webhook`, and
   construct `auth.NewService` with them as `PublicPaths`.
5. construct `Web` with the projects and the auth service.
6. derive the worker context, start the watchers and the sync loops,
   `srv.Run`, `stopWorkers`, wait (section 7).

`newTestServer` moves the same way: it builds auth before `Web` today
(`server/server_test.go:78`), and it has to build the projects first so a
test can put a real hook path in `PublicPaths`. The change is mechanical
and every existing caller keeps its behaviour, because a server with no
webhook project passes an empty list.

### 12. Logging

Three lines, and none of them can print a secret.

- Accepted: `[DEBUG] webhook <project>: delivery accepted (<scheme>)`,
  where scheme is `hub-signature` or `gitlab-token`. DEBUG because a busy
  repository sends many and the interesting output is `Sync`'s own.
- Rejected: `[WARN] webhook <project>: rejected a delivery: <reason>`,
  with reason from a closed set: `no signature header`,
  `malformed signature`, `signature mismatch`, `token mismatch`,
  `body too large`. A failed verification has to be visible, because a
  rotated secret on one side looks exactly like silence otherwise.
- The startup line for a remote project names both switches, so the
  configuration is readable in the log: `[INFO] project <name>: remote
  <url>, pull <d>, webhook on`.

What is never logged: the secret, the computed HMAC (it is derived from
the secret), the presented signature or token, and the body. The secret
is in `secretsOf` as a second line of defence, but the handler does not
rely on it.

The request logger already records method, path and status at DEBUG
(`server/server.go:234`), so the WARN adds the reason and nothing else.

## Key decisions

**Two independent switches, not a mode enum.** Follows the given
constraint, and the code agrees with it: `pull` is already a field on
`history.Remote` that is read by a ticker in `main`, and the hook is a
second sender into the same loop. A `mode` field would have to encode a
combination the two-switch form gets for free, and would forbid the
combination worth recommending.

**Nothing in `history` changes.** The whole feature is one handler in
`server`, one channel and one loop in `main`, and one field in `auth`.
`Sync`, `Record`, the lock, the credential injection and the two states
are used exactly as the multi-source design left them. This is the
strongest argument that the feature is proportionate: if it needed a
change in `history`, it would be a different feature.

**The endpoint never reads the payload.** Rejected: parsing the JSON to
filter by branch or event type. It buys one saved fetch per irrelevant
push and costs a parser that has to know GitHub's, GitLab's, Gitea's and
Forgejo's shapes, keep knowing them, and decide what an unparseable body
means. A fetch that finds nothing is cheap and cannot be wrong.

**Both provider schemes, HMAC preferred.** Rejected: GitHub only, which
would leave GitLab with no way in. Rejected: GitLab only, which would
throw away the stronger scheme for the more common provider. The header
decides, so there is nothing to configure and nothing to get wrong. The
plain-token scheme puts the secret on the wire, so it is only as safe as
the TLS in front of it, which belongs in the README next to it.

**No timestamped-signature scheme in v1.** Rejected for now: verifying a
Standard Webhooks style `webhook-signature`, an HMAC over
`id . timestamp . body`. It is not one more `if`: a timestamped signature
is only worth anything with a replay window and a clock-skew tolerance,
which means a constant, a clock in the handler, a test that moves it, and
a new rejection reason for a delivery that is merely late. That is a
third verifier, and the whole premise of this document is one. The open
question in the next section says what would make it necessary.

**A minimum length on the hook secret, and only on the hook secret.**
Rejected: leaving it to the operator, on the theory that the provider
generates it. It does not. An empty `hook_secret_file` resolves to the
empty string, an HMAC with an empty key is publicly computable, and the
result is an unauthenticated endpoint that makes the server fetch. The
git resolver keeps allowing empty, because a credential-less public
remote is a real deployment; the hook call site adds one check.

**The secret is never in the URL.** Rejected: `/p/<project>/hook/<secret>`
or a `?token=` query, which some tools suggest. It would land in access
logs, in the provider's delivery list, and in anything that keeps a URL,
and it would make the public path a prefix rather than an exact match.

**202 and nothing else.** Rejected: running `Sync` in the request and
answering with its result. It would hit the provider's delivery timeout
on a slow remote and hold the history lock across a network round trip,
blocking saves. The provider does not want a result; it wants a receipt.

**A capacity-one channel, not a goroutine per delivery and not a queue.**
Rejected: a goroutine per delivery, because they would serialize on the
history mutex and multiply an identical fetch. Rejected: a debounce
timer, because the channel already coalesces everything that arrives
during a run and the leftover cost is one extra fetch after a burst.
Rejected: a work queue, because the queue can only ever hold one distinct
item.

**The route is under the project prefix.** Rejected: a global
`/hooks/<project>`, which would name the project outside its own subtree
and break the rule that a project is one contiguous prefix a middleware
can be mounted on.

**`/hook`, not `/api/hook`.** Keeps the single public path out of the API
subtree, so a future mistake in the public list cannot expose the API.
Nothing in the frontend calls it, so it is not API surface anyway.

**An exact-match public path, not a public prefix.** `hasPathPrefix`
(`auth/auth.go:322-329`) makes a prefix cover everything below it, which
is right for `/static` and wrong for one endpoint. The new `PublicPaths`
field is five lines and it is what keeps the exception one path wide. The
multi-source design already wanted an exact-match form for `/` and
declined to add it; this is the same mechanism, for a case that cannot be
declined.

**`POST` and `GET` registered separately, not one methodless pattern.**
Corrected: a methodless pattern is not a free way to claim every method,
it is a startup panic against the per-mount `GET <prefix>/{path...}`
catch-all under ServeMux's conflict rules (section 3). The `GET`
registration still exists for the original reason, to keep a public path
from falling through to the app shell; it just carries its method now,
and everything outside the two goes to ServeMux's own 405.

**A hook on a non-remote project is a startup error.** Rejected: a
runtime 404 or a silently ignored setting. The multi-source design
already refuses configurations it cannot honour at startup, and a
config error that shows up as a rejected delivery three days later is
the failure mode this avoids.

**The worker context is derived in `run` and canceled explicitly.**
Rejected: copying the watcher's current await, which deadlocks when
`Web.Run` returns on a failed listen while the context is still live
(`server/server.go:164-171`, `main.go:241`). This design needs the fix
anyway, and it is three lines, so it fixes the existing case in the same
change rather than adding a second goroutine to the same trap.

**No provider field, no event filter, no delivery dedup, no UI.** Each
was considered and cut. The provider is in the header, the events are all
the same to us, a replayed delivery costs one fetch, and a webhook is
operator configuration whose failures belong in the log.

## Risks / open questions

- **GitLab's current signing scheme has to be confirmed before this is
  built.** This design verifies `X-Gitlab-Token`, the secret token GitLab
  has sent for years, and that is what v1 supports. A review reports that
  recent GitLab documents a Standard Webhooks signing token instead, sent
  as a `webhook-signature` header with a `whsec_` key and computed over
  `webhook-id . webhook-timestamp . body`, and treats the plain token as
  the weaker legacy option. That cannot be checked from here, so it is an
  open question and not a change: **read GitLab's current webhook
  documentation before implementing section 4.** If the plain token is
  still sent, nothing changes. If it is gone or deprecated to the point
  of being unusable, the branch is replaced rather than added to, and the
  replacement brings a replay window and a clock-skew tolerance with it,
  which is the cost the key decision above names. Either way the verifier
  stays at two branches.
- **The body cap is a guess at the providers' limits.** 25 MiB comes from
  GitHub's documented payload limit. Confirm it, and GitLab's, Gitea's
  and Forgejo's, before implementation. Too small and a busy repository
  gets `413`s that look like a scrawl bug; too large only widens what an
  unauthenticated caller can make the server read. It is one constant and
  the streaming verifier does not care what it holds.
- **A missed delivery is invisible.** Section 8 says this plainly: no
  detection, no catch-up. The mitigation is the safety-net poll, and the
  recommendation is to keep it on. This is the main thing to get right in
  the README.
- **The endpoint does unauthenticated work.** A caller who cannot forge a
  signature still makes the server read up to `maxHookBody` and hash it,
  once it has sent a well-formed `sha256=` header. The global throttle
  bounds concurrency (`server/server.go:233`) but not rate, and the login
  limiter does not apply (`auth/auth.go:282`). Accepted: one streamed
  sha256 over a bounded body is cheap next to receiving those bytes at
  all, the malformed-header path costs nothing, and the 32-byte minimum
  is what keeps the answer from being guessable. If it ever bites, the
  fix is to reuse `auth`'s limiter, not to invent a second one.
- **A flood of failed deliveries floods the log.** Every rejection is a
  WARN, on purpose. If a misconfigured sender makes that noisy, the
  answer is to stop the sender, not to hide the line. Worth watching once
  it is deployed.
- **A replayed delivery is accepted forever.** We check no timestamp and
  no delivery id, so a captured valid delivery can be resent. The result
  is one `Sync`, which is idempotent. Accepted, and it is the direct
  consequence of not reading the body.
- **Secret rotation needs a restart.** Consistent with the multi-source
  design, where reconfiguring a project without a restart is already out
  of scope. Rotating on the provider first means rejected deliveries
  until the restart, which the WARN makes visible.
- **The plain-token scheme is only as safe as the transport.** GitLab
  sends the secret in clear in a header. Behind plain HTTP it is
  readable. The README has to say the endpoint belongs behind TLS.
- **A hook does not make a diverged project recover.** If the ff-only
  merge fails, every delivery makes it fail again, faster than the ticker
  did. `syncError` already says so and the fix is already manual. The
  only new cost is more log lines while it is broken.
- **A delivery during a save waits for the history lock.** That is the
  existing invariant, not a new one, and the 202 already went out. Worth
  confirming once that a sync triggered during a long save behaves like
  a ticker-triggered one.

## Implementation outline

Each step leaves the tree building and the tests green. It all lands
after the multi-source design, because every piece of it names a type
from there.

1. **`auth`: the exact-match public path.**
   Add `PublicPaths []string` to `Config`, store it on `Service`, check
   it in `isPublic` (`auth/auth.go:312-320`) with `==` beside the prefix
   loop. Document on the field that nothing below it is public, and why.
   Extend the public-path table test (`auth/auth_test.go:334-352`) with
   the trap cases: the exact path is public, the path plus `/extra`, the
   path plus a suffix character and a different project's path are not.

2. **`main`: resolve and check the hook secret.**
   Rename `resolveToken` to `resolveSecret` and call it a second time for
   `hook_secret_file` / `hook_secret_env`, plus the fixed
   `REPO_HOOK_SECRET` on the flag path. Add the four syntactic rules of
   section 2, the 32-byte minimum among them, and extend the canonical
   phase's outside-all-roots check to cover every hook secret file
   beside the session key, resolving each through its parent directory.
   Put the resolved value in `secretsOf` and unset the source variable.
   Tests: a hook secret without `repo:` refused, both fields refused, a
   named variable with no value refused, an empty file refused, a file
   holding only a newline refused, a short file refused, a hook secret
   file inside its own project root refused, one inside another
   project's root refused, one whose parent is a symlink into a project
   root refused, the variable gone from `os.Environ()` afterwards, and
   the value present in `secretsOf`.

3. **`server`: the endpoint.**
   Add `Webhook` and `Project.HookPath()`. In `projectRoutes`, when
   `prj.Webhook != nil`, register `POST <prefix>/hook` and
   `GET <prefix>/hook` to the same handler, before the catch-alls. Write
   `hookHandler` on the `mount` receiver: method check, header shape
   first, then the two schemes, `maxHookBody` through `io.Copy` into the
   hash, `hmac.Equal` and `subtle.ConstantTimeCompare`, the four status
   codes, the two log lines. Keep it outside the `mutating` group and say
   why in a comment. Tests through `newTestServer`
   (`server/server_test.go:59-108`) with a `Notify` that counts calls: a
   valid signature gives 202 and one call; a valid GitLab token the same;
   a wrong signature, a wrong token, no header at all, a `sha256=` with
   bad hex, a `sha256=` of the wrong length and a signature valid for a
   different body each give 401 and no call; an oversized body on the
   signature branch gives 413 and no call; a `GET` and a `HEAD` give 405,
   and so does a `PUT` (from ServeMux); a project with no `Webhook` has
   no such route. One test builds a router with a webhook project and the
   `{path...}` catch-alls and asserts it builds at all, which is the
   regression test for the pattern conflict. One test with
   `withAuth: true` and no cookie proves the public-path exception end to
   end.

4. **`main`: the trigger, the loop and the shutdown.**
   Give `runtimeProject` a `trigger chan struct{}` of capacity 1 and a
   `notify()` with a default branch. Write `syncLoop(ctx, rp, run)` with
   the nil-ticker trick and the `ctx.Err()` recheck, and start it when
   either switch is on. Reorder `run` as section 11 lists it, derive the
   worker context, and call `stopWorkers()` right after `srv.Run`
   returns, before waiting on the watchers and the loops. The coalescing
   test takes `run` as a parameter: fire the trigger twenty times while a
   slow `run` is in flight and assert it ran twice, not twenty times.
   Also test a listen address already in use (`run` returns the error and
   does not hang), `pull: 0` with no trigger (the loop sits idle and
   still exits on cancel), and a cancel with a trigger already queued
   (the loop returns without calling `run`).

5. **Documentation.**
   README: the `hook_secret_file` / `hook_secret_env` /
   `REPO_HOOK_SECRET` trio next to the git credential ones, the
   `openssl rand -hex 32` recipe and the 32-byte minimum, the URL to
   paste into GitHub and GitLab, the two schemes and that the endpoint
   belongs behind TLS, and the recommendation to keep a slow `pull` as
   the safety net with what a missed delivery costs without one.
   CLAUDE.md: one rule saying the webhook is an optional second trigger
   for the same `Sync`, that a verified POST is a trigger and never a
   payload, that it answers 202 and coalesces, and that its path is the
   one exact-match public route on the server, registered per method
   because a methodless pattern collides with the project catch-all.

6. **`make lint`, `make race`.**

Not planned: an e2e spec. The browser suite has no provider to deliver
from, and reproducing one means signing a body in the spec to exercise a
handler the Go tests already cover from both schemes and every failure
path. If the remote e2e instance with a local bare origin exists by then,
a single spec that posts a signed delivery and waits for the note to
appear is about ten lines and worth adding on top; it is not worth
building the instance for.

One small development note: `web/vite.config.ts` proxies
`/p/<name>/api` and `/p/<name>/raw` and bypasses the rest of `/p` to
vite's `index.html`. A delivery aimed at the dev server would hit the
bypass, so add `/p/<name>/hook` to the always-proxy list if anybody ever
points a provider at a dev instance. Nothing depends on it.
