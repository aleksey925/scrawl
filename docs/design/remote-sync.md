# Remote sync

A space whose directory is a git clone: pull, push, divergence and reset.

## Startup

- A remote space is a local space whose directory is a clone. `history` gains a
  `Remote`, `main` clones before the canonical validation phase, and nothing
  else changes shape. The startup order is part of the design: open store,
  `Reconcile`, `Sync`, `indexAll`, `Watch`. `store.Watch` takes its baseline
  when it is called, so a fast-forward that lands after it produces no event at
  all. The first clone lands in a staging folder inside the space's directory
  and its entries are moved up one level: that directory is what an operator
  mounts, its parent is often read-only, and a mount point can be neither
  removed nor renamed over. The clone is full depth, because a shallow one
  breaks the history log and the push.
- The startup `Sync` and the check that the remote takes a push run before the
  server serves, one space after another. On a network that hangs instead of
  failing, the fetch and the push of `Sync` can each take their 5-minute
  timeout, and the check its 10-second one, so the app starts late. This is
  accepted.
- A clone that cannot push does not commit either. The effective read-only mode
  of a remote space is `PullOnly`, and `history` is the one place that knows
  it: `Reconcile` refuses there, so the startup call and the watcher's are
  covered by the same line and `main` asks rather than deriving the mode a
  second time. A commit no push can carry would sit in this copy alone, report
  the space unpublished for a change no reader made, and be what the next
  fast-forward trips over. A read-only **local** space still reconciles: there
  is no remote for the commit to fail to reach.

## Locks

- Three locks, always taken in this order: the network lock `netMu`, the
  history lock `mu`, the status lock `statusMu`. Nothing takes `netMu` while it
  holds `mu`, and nothing takes another lock while it holds `statusMu`.
  - `mu` covers the work tree, the index, `HEAD`, the branch ref and the paths
    a failed commit left: the change and the commit of a write, the commit of
    `Reconcile`, the `merge --ff-only` after a fetch, the local steps of a
    reset, and the measure.
  - `netMu` covers every fetch and every push, the tracking ref they write, and
    every `publish` of the snapshot. A whole `Sync` runs under it, and so do
    each push of the loop, a retry, the push of a token write, the divergence
    check and the reset.
  - `statusMu` guards only the snapshot and the two push flags of
    [Pushing](#pushing), and is never held across a git command.
- No fetch or push holds `mu`. On a network that hangs instead of failing, a
  network command runs for minutes, and every save would wait that long for the
  lock. So a save waits only for another save, a fast-forward or the local part
  of a reset, and commits pile up in the local git while the remote does not
  answer.
- Every `publish` runs under `netMu`, and `Record` never publishes. An attempt
  reads the snapshot, changes it and stores it, and the lock keeps two attempts
  apart, so one that started earlier never stores its result over a newer one.
- `measure` takes `mu`. A commit and its push mark are one `mu` section, so a
  measure never counts a commit whose mark is not made yet. Without that, the
  control could say "Not sent" for one poll for a change that is about to be
  sent.
- `lockNet` checks the context after it gets the lock, so a caller canceled
  while it waited runs no git and publishes nothing. The wait itself is bounded
  by the holder's own context and the `WaitDelay` of git.
- A commit can run next to a fetch or a push. A fetch and a push never touch
  the index or the work tree, they write the tracking ref while a commit writes
  the branch ref, each behind its own lock file, and the object store only
  grows. Two fetches, or a fetch and a push, would meet on the tracking ref,
  and a fast-forward or a reset next to a commit would meet on the index, so
  those stay apart. A push sends the `HEAD` it read at its start; a commit that
  lands later waits for the next push, which its mark brings.
  [Quirks](../quirks.md#git-and-git-hosts)
- A save during a fetch can diverge the space: when the remote gained a commit
  and the save lands while the fetch runs, the fast-forward fails. Both sides
  really changed, which is the case the reset is for, and a save that lands
  just before the fetch does the same. The window grows with the time a fetch
  takes, and a webhook makes it more likely, since it fetches right after the
  remote moved. This is accepted.

## Conflicts and reset

- `--ff-only` is the whole unattended conflict policy. scrawl never merges,
  never rebases and never resolves: a diverged space keeps serving, keeps
  committing locally, and says so loudly. The one way out is a reset to the
  remote version that a person confirms on the page, and nothing destructive
  ever runs without one.
- `diverged` is measured by ancestry when a fast-forward fails, and never read
  off the `merge:` stage word. A merge fails for other reasons too - a file
  left in the way - and offering a reset there would be offering to throw a
  healthy copy away. A diverged copy does not try the push a save would make:
  the remote refuses it every time, and its error replaced the divergence on
  screen until the next fetch. Nor does the retry of a failed push run there. A
  fetch that fails later keeps `diverged`, and the page reads the flag alone,
  so the divergence and its reset stay on screen with the fetch's reason after
  it: before, they went until a fetch worked, which is when "diverged" and "not
  sent" were mixed up most.
- What a reset loses is answered by a trial merge (`merge-tree`), not by a
  commit count ([ADR 10](../adr/0010-reset-loss-by-trial-merge.md)). A conflict
  means "something is lost" by itself, whatever the merged tree shows: a file
  deleted here and edited there merges to the remote version, so the tree has
  no difference and the deletion is exactly what is lost. Anything not proved
  clean keeps a backup branch.
- The check and the reset each run one whole `Sync` first, under the network
  lock, and work on the two commit ids from then on. The reset takes the pair
  the check answered and refuses any other, the way a save takes a `rev`. An
  unlocked check would pair the ids of one state with the merge of another. The
  reset takes the history lock twice and never across the network: once for the
  tips, the commit of what is on disk, the trial merge and the backup ref, and
  once for `reset --keep`, so saves in other tabs do not wait for the push of a
  backup. The second time it first checks that `HEAD` is still the head after
  its own snapshot commit, and refuses as "changed" when not: a save made in
  between is not in the backup, and the reset would drop it from every branch.
  It compares with the head after the snapshot and not with the checked one, so
  what it just committed from disk is not taken for a save. The backup it made
  stays, and the log names it, since the `412` does not.
- The reset is `reset --keep` plus a check of our own, never `--hard`
  ([ADR 11](../adr/0011-reset-keep.md)): every path the remote adds is looked
  up on disk first, and one that is there and untracked refuses the reset. A
  writable space commits what is on disk before the backup is taken; a
  pull-only one never commits, so there the refusal is the whole protection.
- A backup reaches the remote only when the reader ticks it, and before
  anything is reset: a force-push can be how a secret was removed, and a backup
  pushed by default would bring it back. A push that fails stops the reset,
  because a backup promised on the remote and missing there is a reason not to
  let go of the copy.
- The reset is not behind the read-only guard. A read-only mirror whose
  upstream was rewritten needs it most, and no note anybody wrote here is
  changed. `canReset` asks who is calling instead: a session or a read-write
  token. With auth off nobody is calling, so the write guard decides, and a
  read-only space on an open server cannot be reset from the page at all.
  `/api/me` and both routes ask that one function.
- A merge driver is a command the repository config names, and a trial merge
  runs it. `.git/info/attributes` therefore sets `merge` beside the filter
  unset: set, not named, because a name is looked up in the config first, where
  even `text` can be a command.
- After a reset the page reloads whole. Every screen holds an answer from the
  copy that was just replaced, and no screen refetches on its own; the result
  is shown in the dialog and not in a toast, because it names the backup branch
  and a toast is gone in seconds.

## Pushing

- A write from the page is committed in its request and pushed after the
  answer. The push went over the network inside the request, so a delete, a
  save or an Undo made the person wait a second or more for a step they never
  see. One push loop per space runs under the worker context: every commit
  marks a push due, and the loop pushes 3 seconds after the mark, under the
  network lock and not the history lock, with the state it finds then. The wait
  sends a run of writes, a delete and its Undo, as one push. A write that comes
  while a push runs marks the next one, and a write that commits nothing, a
  save of the same text, marks nothing. A write from the page never pushes in
  its request, also when no loop runs: the loop starts after startup and ends
  at shutdown, and a save in those windows would wait on the network. A save
  made before the loop runs leaves its token in the channel, and the loop
  pushes it once it starts; a commit made after the loop ended stays, and the
  next startup's sync pushes it.
- A write with an API token also pushes in its request, because a script is
  told whether its change reached the remote. It pushes also when it commits
  nothing and marks nothing: the same text may sit only in an earlier commit
  whose push failed, and a push with nothing new is one cheap round trip. It
  waits for the network lock, behind a fetch or a push already on its way, and
  never for the history lock, so other writes commit meanwhile. Its push
  carries its commit, since it reads `HEAD` after the commit. The loop still
  pushes after it, because its mark stays: when its request ends before the
  push, or its measure fails on the dead context, the commit is not stranded.
  When its own push went through, the loop's finds nothing new, which costs one
  round trip and "Sending" for about 3 seconds.
- The watcher's `Reconcile` commits and marks a push like any other commit, so
  the control says "Sending" until the loop's push ends, and a measure in
  between never says "Not sent". It never pushes itself, so the watcher
  goroutine never waits on the network and keeps invalidating pages and
  reindexing while the remote hangs.
- The answer to a write carries the state from before its own push, so a
  routine write gets no "not pushed" warning. `/api/me` says `pushing` while a
  push is due or running, or a retry is running, and the page asks on one
  interval set again after every answer, good or failed: every 2 seconds while
  `pushing`, every 5 while `retrying`, every 60 otherwise, and only from a
  visible tab. So a push that fails reaches the control and the banner in
  seconds and not at the next minute's poll, and one failed poll cannot stop
  the fast ones, which a second timer armed by a new answer did. A tick skips
  while a request is still on its way, so an answer slower than the interval
  still lands, and each request gives up after 30 seconds, so one that never
  answers ends and the ticks go on. `pushing` is read with the state as one
  view, see [Sync state](#sync-state). The pull loop and a webhook do not set
  `pushing`: they bring no commit of this copy, and a periodic pull would spin
  the control every few minutes. A push that never ran because the server
  stopped is not lost: the commit stays, the startup sync pushes it, and when
  that fails too the retry carries on.
- A push that failed is tried again by the same loop, about a minute after its
  last attempt, until it goes through, with no write needed: with `pull: 0` and
  no more saves the commit stayed in this copy for days. The loop has a ticker
  that reads `retrying` from the snapshot, and every path that pushes or syncs
  ends in `publish`, which computes it, so a failure anywhere is caught without
  a signal from each place. A timer armed by each failure would need that
  signal from all of them. `retrying` is true when this copy has commits the
  remote lacks, the last attempt failed, and a retry can help: not on a
  diverged branch, which the remote refuses every time and a person must reset,
  not when the remote refused the token, which is read once at startup so the
  answer cannot change, and never in a pull-only space. A retry is a whole
  `Sync`, fetch then fast-forward then push, not a push alone: when the push
  failed because the remote moved, only a fetch shows the divergence, and a
  push alone would fail the same way every minute. A failed fetch measures the
  count from the tracking branch on disk and reads a refusal the way a push
  does, so a copy restarted offline still knows what it owes and starts
  retrying. Every fetch sets the refusal from its own answer, as a push does.
  If it kept an older one, a pull-only space, which never pushes, would say
  "Access refused" until a restart, and an offline copy would blame the token
  for a remote it cannot reach. A refusal found by a push is found again by the
  next retry's push. The minute is fixed and not a backoff: there is one client
  and one remote, and "tries again in about a minute" is the schedule a person
  is told. It counts from the end of the loop's own last attempt, so a hung
  fetch is not followed by another at once; the pull loop, a webhook and a
  token write still try on their own.
- `pushing` is two flags: `due`, set by the mark of a commit, and `sending`,
  set while the loop's push or a retry runs. The loop's push and a retry both
  run under the network lock, so they never run at once, and one flag serves
  both. A retry never touches `due`, which keeps the mark of a write made
  before it. The loop clears `due` when its push starts, not when it ends, so a
  mark made during a push is never erased, and its token brings the next push.
  The loop stores the result of its push before it clears `sending`, so a poll
  never pairs "not pushing" with the state from before the push.
- The retry has no deadline of its own over the whole sync: the context that
  ends it kills git with `SIGKILL`, and a fast-forward killed half-way can
  leave `.git/index.lock`, which then fails every commit. Every git command has
  a `WaitDelay` of 2 seconds: a killed git with an HTTP remote does not return
  until its remote helper ends, which on a hung network may be never, and the
  lock it holds and the shutdown would wait with it. After the delay `exec`
  closes the pipes and returns; the helper ends on its own and holds no lock of
  the repository. [Quirks](../quirks.md#git-and-git-hosts) In the Docker image
  scrawl is PID 1 and never collects the exit status of a process it did not
  start, so each such helper, like any git killed by a timeout, stays a zombie
  entry after it ends. `docker run --init` or `init: true` in compose reaps
  them.

## Sync state

- Two states, not one. `degraded` is a commit that failed, so a change is on
  disk and not in git. `unpublished` is a commit the remote does not have.
  Reusing `degraded` for both would report a healthy history the moment a later
  commit stages nothing, and would tell a strict caller the change was not
  recorded when it was recorded and only not pushed. `unpublished` is
  **measured**, never remembered, and never the gate on the push.
- `syncStatusOf` derives the state of the sync control from `/api/me` and the
  sync message, the first that holds: blocked (diverged or refused), sending
  (`pushing`), not sent (`unpublished`), a warning (any other sync message:
  history not recorded, a fetch failed with nothing waiting) and sent (a
  writable remote space with none of these). Blocked comes before sending,
  because a write on a diverged space marks a push that never goes, and a
  spinner would say it does. History not recorded is "Not synced" and not "Not
  sent": it does not say whether a change reached the remote. The client reads
  `retrying` and never derives it from the other fields, so the rule has one
  home, in `publish`. The control has no live region of its own: the banner's
  already reads out a warning, and "Sending" and "Sent" after each save would
  be noise next to the editor's "Saved".
- The remote state reaches the client only through `/api/me`, and `apiMe` reads
  it with one `SyncState()` and never a getter at a time: a `Sync` finishing
  between two calls would pair an error from one attempt with the paths of
  another, and a poll would leave that impossible pair on screen for a minute.
  `history` publishes all its values as one snapshot when an attempt ends, and
  every publish runs under the network lock. The snapshot and the two push
  flags sit behind the status lock, and `SyncState()` copies the snapshot and
  sets `pushing` in one section of it, so `/api/me` gets one view from one
  call. Two reads, in any order, can pair a "not pushing" from before a mark
  with a snapshot measured after it, and say "Not sent" with a push due.
- The unsynced path set is measured in the same breath as the count, and only
  when the count says this copy is ahead. It is filtered by what the store
  would serve **before** it is capped - hidden paths must not spend the cap and
  suppress the one visible note that changed - and above the cap the list is
  dropped rather than truncated: past a couple of hundred files the question is
  "the whole corpus", which a per-file badge cannot answer. The diff is
  three-dot, so a diverged branch lists what this copy changed and not what the
  remote did.
- The set rides on `/api/me` and never on the tree nodes, the directory rows,
  the search hits or the page response. A badge that lived on the tree could
  only be refreshed by refetching the tree, which is a full store walk per tick
  per open tab.
- One alert, titled by precedence - `degraded > merge > fetch > push` - and
  carrying every active fact with its own reason. Up to three are true at once:
  `degraded`, a divergence kept from an earlier sync, and the stage the last
  attempt failed at. `syncMessage` writes these words, and the banner and the
  popover of the topbar control both render it. Its live region is always on
  the page, empty or not, and polite: a region put in together with its text is
  not reliably read out. A note's unsynced badge is an `aria-hidden` icon with
  its meaning in hidden text beside it, because a tooltip on an `<svg>` never
  opens on keyboard focus and an `aria-label` on an element with no role is not
  reliably read.
- A push the remote refuses for want of a credential gets its own words and no
  git reason. A public repository clones with no token and takes no push
  without one, and git says that as "could not read Username, terminal prompts
  disabled", which names neither the cause nor the fix. `history` is what
  recognizes it, because it pins `LC_ALL=C` and owns what git prints; the
  client reads a flag and never the error text. A fetch the remote refuses gets
  its own words too, and keeps the git reason below them.
- The client polls `me` quietly and in the background: quiet so a poll meeting
  an expired session opens no dialog nobody asked for, and background so `auth`
  skips the sliding renewal. That marker is set by the client and trusted,
  which is safe in one direction only - it can shorten a session and never
  extend one. The poll never replaces a good answer with nothing and orders its
  responses by generation.

## Credentials

- The credential an operator configures is the **token**, and `main` makes the
  header out of it: `Basic` with a fixed username, which every host this can
  reach accepts. A value that already names a scheme is a whole header and
  passes through, because github.com's git endpoint takes only `Basic` and
  Bitbucket only `Bearer`, and that choice cannot live in a table of providers
  here. A `Basic` value we did not build is refused at startup when what
  follows is not base64: the host answers a header it cannot parse with a bare
  `400`, half a minute into a clone, naming neither the header nor the reason.
- A repository credential is resolved once, in `main`, before `setupLog`, and
  reaches git only through `GIT_CONFIG_*` on the three commands that talk to a
  remote. Never argv: `/proc/<pid>/cmdline` is world readable and `gitError`
  quotes arguments. `history` never opens a file and never reads a variable,
  because a second read could hand git a rotated secret that was never
  registered for redaction. A webhook secret is spelled the same way and read
  by the same helper, and it never reaches `history` at all. No secret is a
  flag of scrawl either: there is no `--repo.token`, and `hash` reads the
  password from stdin and warns when it comes as an argument, because our own
  argv is in `/proc`, in `ps`, in the shell history and in `docker inspect`.

## Webhook

- The webhook is an optional second trigger for the same `Sync`, and `history`
  knows nothing about it. A verified POST is a trigger and never a payload: no
  JSON is parsed, no event type is read, no branch is filtered. It answers
  `202` and never runs git, and deliveries coalesce through one channel of
  capacity one ([ADR 12](../adr/0012-webhook-is-a-trigger.md)). A delivery body
  may be up to 25 MB, the limit GitHub documents: with a smaller cap a busy
  repository's deliveries fail with a 413 the operator never sees. The body
  streams through the cap into the hash, so the cap costs no memory.
- A hook secret that was named and resolves to nothing stops startup. The
  minimum length is checked where the secret is resolved and nowhere else,
  because only there is an empty file still distinguishable from a space that
  asked for no webhook - and an empty file is what a secret that failed to
  mount looks like. The git credential keeps the opposite rule, an empty value
  being a public repository, which is why the one resolver never grew this
  check. Naming no source is the way to have no webhook.
- Its path is the one exact-match public route on the server, registered per
  method. Exact, because a prefix entry would open everything below it; per
  method, because a methodless pattern and the space's shell catch-all narrow
  different things and `ServeMux` calls neither more specific and panics.
  Public means no session required and never no credential required.
