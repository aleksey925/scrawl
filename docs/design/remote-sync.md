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
- A clone that cannot push does not commit either. The effective read-only mode
  of a remote space is `PullOnly`, and `history` is the one place that knows
  it: `Reconcile` refuses there, so the startup call and the watcher's are
  covered by the same line and `main` asks rather than deriving the mode a
  second time. A commit no push can carry would sit in this copy alone, report
  the space unpublished for a change no reader made, and be what the next
  fast-forward trips over. A read-only **local** space still reconciles: there
  is no remote for the commit to fail to reach.

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
  screen until the next fetch.
- What a reset loses is answered by a trial merge (`merge-tree`), not by a
  commit count ([ADR 10](../adr/0010-reset-loss-by-trial-merge.md)). A conflict
  means "something is lost" by itself, whatever the merged tree shows: a file
  deleted here and edited there merges to the remote version, so the tree has
  no difference and the deletion is exactly what is lost. Anything not proved
  clean keeps a backup branch.
- The check and the reset each run one whole `Sync` first, under the history
  lock, and work on the two commit ids from then on. The reset takes the pair
  the check answered and refuses any other, the way a save takes a `rev`. An
  unlocked check would pair the ids of one state with the merge of another.
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

## Sync state

- Two states, not one. `degraded` is a commit that failed, so a change is on
  disk and not in git. `unpublished` is a commit the remote does not have.
  Reusing `degraded` for both would report a healthy history the moment a later
  commit stages nothing, and would tell a strict caller the change was not
  recorded when it was recorded and only not pushed. `unpublished` is
  **measured**, never remembered, and never the gate on the push.
- The remote state reaches the client only through `/api/me`, and `apiMe` reads
  it with one `SyncState()` and never a getter at a time: a `Sync` finishing
  between two calls would pair an error from one attempt with the paths of
  another, and a poll would leave that impossible pair on screen for a minute.
  `history` publishes all its values as one snapshot when an attempt ends,
  behind an atomic pointer, because `Sync` holds the lock across a network
  round trip.
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
  carrying every active fact with its own reason. At most two are true at once,
  one from each family. `syncMessage` is the only thing that writes these
  words, and the banner and the topbar control both render it. Its live region
  is always on the page, empty or not, and polite: a region put in together
  with its text is not reliably read out. A note's unsynced badge is an
  `aria-hidden` icon with its meaning in hidden text beside it, because a
  tooltip on an `<svg>` never opens on keyboard focus and an `aria-label` on an
  element with no role is not reliably read.
- A push the remote refuses for want of a credential gets its own words and no
  git reason. A public repository clones with no token and takes no push
  without one, and git says that as "could not read Username, terminal prompts
  disabled", which names neither the cause nor the fix. `history` is what
  recognizes it, because it pins `LC_ALL=C` and owns what git prints; the
  client reads a flag and never the error text.
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
