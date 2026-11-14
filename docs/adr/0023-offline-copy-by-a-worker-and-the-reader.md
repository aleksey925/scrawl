# 23. The offline copy is a service worker plus the reader's platform

Status: accepted, apart from the network-first navigation, replaced by
[ADR 24](0024-the-app-starts-from-the-copy.md). Where it applies:
[offline copy](../design/offline.md).

## Context

The app needed the server for every screen. A person on a plane or in the
metro, or with the server down, wants to read every note, picture and file of
every space they have, from the installed app first of all, and accepts that
nothing can be changed without a network.

## Decision

- A service worker answers what the browser fetches by itself: the page, the
  chunks, the PlantUML library and `/raw/`. The reader's JSON answers are read
  by a third source of the platform, `offlineSource`, the way a site reads its
  own answers.
- The page writes the copy and the worker only reads it, one writer per cache.
- The copy's requests skip the worker and the HTTP cache.
- One versions list per space, with an ETag, says what changed. Versions are
  mtime and size, and a `release` beside them makes a new release fetch every
  JSON answer again and keep every file.
- `entries` is the progress of a round and the list's `etag` its commit, kept
  apart.
- Cache Storage holds everything, the state records included.
- The worker's list of files comes inside `/sw.js`, so the browser's own check
  of its bytes is the version check.
- The offline shell is a page of its own, named by the hash of its body.
- The worker keeps the previous app version.
- A network-first read has a 3 second deadline when the copy has the answer.
- The owner is set at sign-in by a cookie the page reads.
- The worker exists only while offline access is on.

## Options turned down

- A worker that answers `/api/` too: the tree would be marked and `me` forged
  in the worker, and every offline read would first wait for the network to
  fail.
- A platform alone: a picture in a note is an `<img>`, which no source can
  answer.
- The worker writing the copy: it can be stopped at any time and an iPhone has
  no background sync, while the page has the status line and the session.
- A conditional request per file: a quiet minute would be hundreds of 304s
  instead of one per space.
- A bulk endpoint with every answer inside: huge, with no progress, and a round
  cut short starts over.
- Building the folder lists and the tree in the browser from the list: the
  answers' shapes live in `view`, which is what keeps a site and the app the
  same.
- One record with both progress and commit written as the round goes: a 304
  after a cut round would skip what is missing, for good.
- A content hash per note as its version: every changed list would read every
  note.
- IndexedDB for the state: a second store to delete and keep in step. Local
  storage: 5MB and synchronous.
- `/sw.js?v=<digest>` with the list in a JSON file: an extra request, and an
  old tab would register the old url again.
- Caching chunks only as they are used: an engine never used online would be
  missing offline.
- Keeping the served shell: it names a space and goes out `no-store`, and would
  tie the app cache to a user and could pair an old shell with a new bundle.
  Naming the offline shell by the bundle's digest: the title and the release
  are in its body too.
- Deleting the previous app version at activation: a page open on it would lose
  its next chunk and could not load again.
- Cache first for a space's reads: the person would see old data while online.
- Checking the owner only on the first round: a new user who loses the network
  before the first `/api/me` would see the copy of the one before. Deleting the
  copy on the sign-in page: it would delete the copy of a person whose session
  just expired.
