# Getting out of a diverged project from the page

## Problem

A remote project diverges when this copy and the remote both hold
commits the other does not have: somebody rebased or force-pushed the
branch, or pushed while this copy had unpushed commits. `Sync` then
fails at `merge --ff-only`, and the banner printed

```
merge: the branch has diverged from origin/main; in /data/wiki run:
git pull --rebase && git push
```

That is a console command for a directory inside a container. The
reader who sees the banner usually cannot run it, and the page gave no
other way out. The state never heals by itself.

What the user asked for:

1. A notice with a button that re-reads the state from the remote.
2. A check that says whether that would lose anything.
3. A safe variant: keep the diverged branch under a backup name, then
   move to the remote.

## Decisions

The first draft of this plan was reviewed by codex. Its findings are
folded in below, each marked **(review)** where it changed the design.

### One action, safe by default

There is one button, **Reset to the remote version**. It opens a dialog
that runs the check first and shows the answer, and the reset behind it
keeps a backup whenever the check did not prove there is nothing to
lose. There is no separate "unsafe reset": a second button would only
let the reader pick the worse option, and a local branch costs nothing.

So the three wishes are one flow: notice -> dialog with the check ->
confirm -> reset with backup.

### `diverged` is measured, not read off the error

**(review)** Every failure of `merge --ff-only` used to be reported as
"the branch has diverged". A dirty file in the way fails the same merge.
`SyncState` gains `Diverged`, measured by ancestry (`merge-base
--is-ancestor` both ways) when the fast-forward fails; the reset is
offered on that flag only. A merge that failed for another reason keeps
its real git reason and gets its own title.

A diverged copy no longer tries the push a save would make. The remote
refuses it every time, and its error replaced the divergence on screen
until the next fetch. The flag is re-measured locally before it gates
the push, so a clone somebody fixed by hand pushes again with no ticker.

### The check is a trial merge, not a commit count

"Ahead by N commits" is the wrong question after a rebase: every old
commit counts as ahead although its content is already on the remote.
Patch ids (`git cherry`) fix a plain rebase and still fail on a squash.

`git merge-tree --write-tree --allow-unrelated-histories <remote>
<head>` merges in memory and touches neither the worktree nor the index.
The paths where the merged tree differs from the remote tree are what
this copy has and the remote does not.

**(review)** A conflict means "something is lost" by itself. A file
deleted here and edited there merges to the remote version: the tree
shows no difference and the deletion is exactly what a reset loses. So
`clean` is "exit 0 and no differing path", the conflicted paths are
added to the list, and anything not proved clean keeps a backup -
a trial merge that failed included.

**(review)** `merge-tree` runs the merge driver the repository config
names, which is a command of somebody else's choosing. The attributes
line scrawl already writes to `.git/info/attributes` becomes
`* -filter merge`: the attribute set, which pins the built-in text
merge. Not a name - a name is looked up in the config first.

**(review)** The check runs one whole `Sync` first and holds the history
lock, then works on the two commit ids. An unlocked check against the
last fetched ref would pair the ids of one state with the merge of
another, and would not "re-read the remote" at all.

The list is filtered by `Visible` before it is capped and dropped above
the cap, the same rule and the same `Unsynced` type the unsynced set
uses. A hidden path still makes the answer "not clean"; it is only never
named.

### The reset

`history.ResetToRemote(ctx, ResetOp{Actor, Head, Remote, PushBackup})`,
under the history lock, in this order:

1. One whole `Sync`. In step again -> `ErrNotDiverged`. Failed for
   another reason (fetch) -> that error. Nothing was touched.
2. Compare `HEAD` and `origin/<branch>` with the pair the dialog showed.
   A mismatch is `ErrStateChanged`: the check the reader confirmed is
   not the state being reset. Same idea as the `rev` of a save.
3. Writable project only: commit what is on disk, under the caller's
   actor, so the backup holds it. A pull-only clone never commits; that
   rule stays.
4. Trial merge again. Not clean ->
   `refs/heads/scrawl-backup/<UTC yyyymmdd-hhmmss>-<short id>`.
5. **(review)** `PushBackup` pushes that branch *before* anything is
   reset, and a failed push stops the reset. It is the reader's choice
   in the dialog, never automatic: a force-push can be how a secret was
   removed, and a backup would bring it back.
6. **(review)** Look up on disk every path the remote adds. One that is
   there and untracked refuses the reset: git itself refuses that for an
   ordinary file and silently replaces an *ignored* one.
7. `git reset --keep <remote id>`. `--keep` and not `--hard`: it refuses
   when an uncommitted change would be overwritten. A refusal is
   `ErrResetRefused` and the backup branch stays, it is harmless.
8. Publish the new sync state in one snapshot.

The worktree change reaches the index and the page cache through the
watcher, exactly like a fast-forward that lands in a background `Sync`.

### Who may press it

Not the read-only guard: a read-only mirror whose upstream was rebased
is the project that needs this most, and the reset writes no note
anybody authored here. `canReset` asks who is calling: a signed-in
session or a read-write token. A `:ro` token is refused.

**(review)** With auth disabled nobody is calling, so the write guard
decides: a writable project can be reset, a read-only one cannot. Any
other rule would make the reset a public button on an open mirror.
`/api/me` reports `can_reset` from the same function the routes use.

### API

Both under the project prefix, both POST behind CSRF.

- `POST /api/sync/check` ->
  `{head, remote, clean, lost: {paths, many}, can_push_backup}`
- `POST /api/sync/reset` `{head, remote, push_backup}` ->
  `{backup, backup_pushed}`

Each failure has its own status, so the dialog never parses a message:
409 not diverged, 412 state changed, 422 refused (with the reason),
502 the remote did not answer.

`/api/me` gains `project.diverged` and `project.can_reset`.

### UI

- `syncMessage`: the diverged body names no clone and no command, and
  the message carries `canReset`.
- `ResetAction`, a button drawn by the banner and by the sync popover.
- `ResetDialog`, owned by a provider in the layout, because the popover
  unmounts its content when it closes. Steps: checking, ready (the loss
  report, the backup checkbox), resetting, done, failed.
- **(review)** After a reset the page reloads whole: no screen refetches
  on its own. The result stays in the dialog until then, because it
  names the backup branch and a toast is gone in seconds.

### Not in scope

- Automatic reset for pull-only clones. Tempting, because such a clone
  has no commits of its own, but nothing destructive runs without a
  person.
- Merging or rebasing from the page.
- Listing or restoring backup branches in the UI. They are ordinary
  branches, on the git host when the checkbox was on.
- A copy that is only ahead of a remote that was reset backwards. The
  fast-forward calls that "up to date", so no error shows it today.

## Files

- `history/reset.go` (new): `CheckDivergence`, `ResetToRemote`.
- `history/remote.go`: `SyncState.Diverged`, the gated push.
- `history/write.go`: `reconcileLocked` out of `Reconcile`.
- `history/git.go`: exit status 1 as an answer; `history/history.go`:
  the attributes line.
- `server/sync.go` (new): the two handlers and `canReset`.
- `web/src/shell/ResetDialog.tsx` (new), `syncMessage.ts`,
  `ProjectAlerts.tsx`, `SyncControl.tsx`, `AppLayout.tsx`.
- Tests: `history/reset_test.go`, `server/sync_test.go`,
  `e2e/tests/sync.spec.js`.
- Docs: `README.md`, `CLAUDE.md`.
