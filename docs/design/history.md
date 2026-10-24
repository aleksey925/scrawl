# History

Git-backed versions of the notes, and how two versions are compared.

## Recording

- Document history is git and optional: `--history=auto|on|off`, except for a
  remote space, where it is always on and tracks every visible file - one that
  stopped recording would also stop pushing, and the editor opens far more
  types than the extension list keeps. The repository has to be rooted exactly
  at the notes root; one that merely sits inside another repository is refused,
  never adopted. Only the paths an operation names are staged, never the
  worktree, because ignore rules cannot express what `store` treats as visible:
  git will not descend into an excluded directory, and a `.gitignore` among the
  notes outranks anything scrawl writes. The store mutation and the commit are
  one critical section, otherwise a second request's commit picks up the first
  one's write and signs it with the wrong actor. A version is read by its blob,
  because a path stops resolving against an older revision once a rename sits
  in between. A failed commit is fatal only for an API token, so an agent never
  gets a 200 for a change history missed; a browser save survives it and the
  page says history fell behind. Paths reach git NUL-separated on stdin and
  never in argv, and the tracked set is read as the whole index rather than
  path by path, because a reconcile of a large corpus does not fit in argv.
- An adopted repository is not inert. Its config and its `.gitattributes` each
  name a command git would run during an ordinary commit, so hooks go to a
  `core.hooksPath` that can hold none, `core.fsmonitor` is overridden empty,
  and the filter attribute is unset in `.git/info/attributes`, where the last
  matching line wins. Nothing of ours is created inside that repository beyond
  that file, and a symlink standing where it belongs is removed rather than
  written through. Failing to establish any of this stops startup: a repository
  that runs its own command on every commit is not a degraded mode worth
  serving. Diff and log run with `--no-ext-diff` and `--no-textconv`, since a
  diff driver and a textconv filter are commands the repository names too.
  Every git call drops each `GIT_*` variable of the host, because `GIT_DIR`,
  `GIT_INDEX_FILE` or an author override would send a commit somewhere we never
  looked, and `safe.directory` names the exact root, never `*`.
- History answers only for paths the app would serve anyway: markdown, and
  visible to `store`. Git tracks whatever the repository holds, a file the
  store hides included, so without that check the history routes are a second
  way into the notes with no policy on them. A blob is resolved from the commit
  and the path it belonged to, never taken from the request, and a restore is
  bounded by the same size an ordinary save takes.

## Comparing versions

- A version is compared as a reader sees it
  ([ADR 13](../adr/0013-compare-rendered-versions.md)). `htmldiff` takes the
  HTML `render` made of both sides, lines up the top-level blocks by their
  visible text and marks the changed words inside a pair, so a reflowed
  paragraph, a padded table or a formatter's pass is a `format` row and never
  rewritten text. Where a link points and which picture is shown are part of
  that text, and inside a code block the whitespace is too: the same words with
  another indent are another program. Ids are dropped, because both sides share
  one page. A change has two layouts drawn from the same rows, and split is the
  default in the app and in `scrawl diff`: split puts the version before beside
  the one after, block by block, and stacks them below the width two columns
  need. Unified is the note as it reads now, in one column, with a tag beside
  each block that changed: a changed block is one block with its lost words
  struck and its new words marked, which `htmldiff` builds as `Inline`, and a
  removed block is struck through. The patch stays beside them as the `Source`
  view, and a version too large or too slow to compare still answers with the
  patch alone.
- The diff markup is written twice, by `web/src/diff/RenderedDiff.tsx` and by
  the templates of `page`, and `web/src/diff/diff.css` styles both. A change to
  one is a change to the other, folding included.
