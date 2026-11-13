# Offline copy

How the app keeps every note, picture and file of a user on the device, and
reads them with no network. The word in the code and the docs is "offline
copy", never "sync": sync is the git remote of a space
([remote sync](remote-sync.md)). Why it is built this way:
[ADR 23](../adr/0023-offline-copy-by-a-worker-and-the-reader.md).

## On and off

- An installed app (`display-mode: standalone`, or `navigator.standalone` on an
  iPhone) has it on by default. A plain browser has it off, and the switch
  "Offline access" in the space menu turns it on. A choice made with the switch
  is kept per device in local storage, `scrawl.offline` (`on` or `off`), and
  wins over the default.
- The service worker is registered only while it is on, so a browser where it
  is off runs the app exactly as without the feature.
- It needs a secure page: a service worker, Cache Storage and `navigator.locks`
  exist only on `https:`, `localhost` and `127.0.0.1`. On plain http the switch
  is disabled with `Needs HTTPS` and none of the offline code runs.
- Off deletes every cache and unregisters the worker, with no question: all of
  it is on the server. It first tells the other tabs to stop their round and
  waits for the copy's lock, so a round in another tab cannot write into a
  cache just deleted.
- On again in the same page can bring back the worker Off unregistered, with no
  install ([quirks](../quirks.md#browsers)), so every registration asks the
  active worker to download the app again when its cache has no shell. A cache
  that only exists is not enough: `addAll` stores all or nothing, and a worker
  stopped during the download leaves the cache there and empty.
- The work of On and Off in a page runs one after the other, in the order of
  the taps, so On tapped while Off still deletes the caches registers the
  worker after Off has unregistered it. The registration at start waits in the
  same line.
- A registration that fails, at start or by the switch, shows
  `Could not update` until the next one: the copy of the data alone does not
  open the app with no network.

## Two caches, one writer each

- `scrawl-app-<build>` holds the app: every file of the bundle, the PlantUML
  library, `chroma.css`, the icons and the offline shell. Only what `/static/`
  gives to anyone. The worker writes it when it installs and when a
  registration finds it without the shell. It reads it with `caches.match`,
  never `caches.open`: that makes an empty cache.
- `scrawl-data` holds the user's data: the answers of every space
  (`/api/page/`, `/api/dir/`, `/api/nav?path=`, `/api/me`, `/raw/`),
  `/api/spaces`, and two kinds of record under keys no route answers:
  `/__scrawl-offline/state` (`{owner, updatedAt, error}`) and
  `/__scrawl-offline/space/<name>` (`{etag, entries}`). The page writes it, the
  worker only reads it. `entries` is read into an object with no prototype, so
  an entry named `constructor` or `__proto__` is a key like any other.
- Each stored answer is the whole response with its headers, so a `/raw/` file
  read offline keeps `default-src 'none'; sandbox`, `nosniff` and its
  `Content-Disposition`.
- A key is the url the app's helpers build (`answerUrl` in
  `web/src/offline/keys.ts`), shared by the page and the worker. The worker
  turns the path of a `/raw/` request into the same form: the renderer writes a
  picture's url with Go's `url.PathEscape`, which leaves `$&+,:;=@` as they
  are, and `encodeURIComponent` escapes them.

## The worker

`/sw.js`, scope `/`, built from `web/src/sw/sw.ts` into `server/assets/sw/`.
The server puts one line before it,
`self.scrawlOffline = {build, shell, assets}`, built once at startup:

- `assets` lists every file under `/static/<digest>/app/` but vite's
  `manifest.json` and `index.html`, the whole PlantUML library under
  `/static/<digest>/plantuml/`, `chroma.css`, the favicon and the icons with
  their stamp, and the offline shell. `build` is a hash of the release, that
  list and the worker's own code. So the bytes of `/sw.js` change when anything
  the app loads changes, and the browser's own check of them installs the new
  version.
- Install caches the whole list or nothing: one missing file fails it, and a
  server upgraded in the middle answers 404 for the old digest. Then it takes
  over at once.
- Activate keeps its own cache and the one before it, and deletes the rest. A
  page still open on the previous bundle, maybe with an editor holding unsaved
  text, keeps getting its chunks.

The fetch rules, GET only; what no rule names is not touched:

1. a request of the copy itself (`X-Scrawl-Offline-Copy: 1`) goes to the
   network, so the copy never stores the worker's own old answer as a new one;
2. `/static/` is answered from the current app cache, then from an older one,
   else the network;
3. `/s/<name>/raw/` goes to the network first, and to the data cache on a
   network error, a 5xx that is not scrawl's own answer (`serverUnreachable` in
   `keys.ts`, the app's rule below), or no answer in 3 seconds. A `Range`
   request answered from the cache gets a 206 cut from the stored body, which
   is read only then and never for a request the network answers. While
   `scrawl_signin` is set, no app has read it yet and the copy may still be the
   user's before, so the request goes to the network only. The worker reads the
   cookie with `cookieStore`; a browser with no `cookieStore` gets the same
   rule only for a navigation from the sign-in page;
4. a navigation under `/s/<name>/` but `api/` gets the offline shell at once
   when the copy holds the space's `me`, and the app starts on the copy. While
   `scrawl_signin` is set, by the test of rule 3, or when the copy has no `me`
   of the space, it goes to the network first, then to the offline shell. `/`
   answers a redirect to the first stored space on the same terms. A session
   that ended shows the copy until `/api/me` answers 401, then the sign-in
   page. Why: [ADR 24](../adr/0024-the-app-starts-from-the-copy.md).

The 3 seconds are for the headers, not the body, and apply only when the copy
has the answer; without one the worker waits for the network. While a page has
said on the `scrawl-offline` channel that the app is offline, rules 3 and 4
read the cache first, with no wait. A page in its start check says nothing
there until the check ends: the worker is shared, and another tab that is
online would get its files from the copy.

## The offline shell

`/static/offline/<hash>.html` is the app's shell with no space and no cookie:
the auto theme, the site title and an empty `data-base`. `<hash>` is a hash of
the body, so a new title, release or bundle is a new url, cached in the same
install as the chunks it loads. `mountBase()` takes the space from the address
when `data-base` is empty. Both shells carry `data-version`, the release.

## The versions list

`GET /s/<name>/api/versions` lists every entry of the space's tree, built by
`view.Versions` from `Store.Tree()`, so it lists what the app lists and reads
no file. A note's or a file's version is its mtime and size, the rule of the
`/raw/` ETag. A folder's is a hash over its whole subtree, because a folder's
list shows the count of each subfolder. `release` is the scrawl version: a
rendered answer depends on it, the bytes of `/raw/` do not. The answer has an
ETag, the hash of its body, and a failing tree is a 500, never an empty list,
which would tell the copy to delete the space.

## A round

The copy runs in the page (`web/src/offline/copy.ts`): a worker is stopped when
idle, an iPhone has no background sync, and the status line lives in the page.
Every request of it is background (no session renewal, no trip to the sign-in
page), `cache: 'no-store'`, and carries the copy's header.

1. It runs only when the copy is on, the app is online and `/api/me` has
   answered in this tab, and at most every 20 seconds, apart from a round soon
   after the person's own change and one on the way back online.
2. It takes the Web Lock `scrawl-offline-copy` if it is free; a tab that does
   not get it skips the round. The tab holding it posts its progress on the
   `scrawl-offline` channel, and a tab that opens asks for it there, so every
   tab shows the same `Downloading...` line.
3. It asks `/api/spaces`, then `/api/me` of the first space, itself, under the
   lock: the user of the session is the owner, not the one the tab last heard
   of, which an answer late from before a sign-in elsewhere could bring back.
   When `state.owner` is another user, `scrawl-data` is deleted first.
4. It stores `/api/spaces`, and deletes a stored space not in it.
5. For each space it asks the versions list with the stored `etag`. A 304 means
   every answer of that list is stored. Otherwise an entry is fetched when it
   is new, its version differs, or for its JSON answer its release differs; an
   entry gone from the list is deleted, and so are the answers of an entry
   whose kind changed, a file that became a folder.
6. The difference of all spaces is fetched four at a time. An entry is recorded
   only when all its answers came with a 200 and were stored, with the version
   from the list, not from the answer, so a file changed meanwhile is fetched
   again. A JSON answer without `Content-Type: application/json`, the page of a
   proxy or a captive portal, fails the entry like a 5xx. `entries` is written
   every 2 seconds, so a round cut short goes on where it stopped. A 4xx drops
   the entry: the file is gone, refused or too big, and asking again would get
   the same answer. A 403 also leaves the space's `etag` unwritten with no
   failure shown: read rights given back change neither mtime nor size, so only
   a list asked in full finds the file again. A 5xx, a 408 or a 429 keeps the
   old copy, and the next round asks again.
7. The nav and `me` of each changed space are stored.
8. A space's `etag` is written only when every entry of its list succeeded:
   `entries` is the progress and `etag` the commit, so a round that failed
   somewhere gets the list again next time and fetches what is missing. The
   stored `etag` is cleared before the round changes anything of the space: the
   list's ETag is a hash of its body, and a tree back to the committed one
   would otherwise answer 304 over a copy half moved on. `updatedAt` is written
   when every space is done.

Rounds start when `/api/me` answers: on open, when the page becomes visible and
every minute while it is visible. A network error, a gateway's 5xx and the
`offline` event stop a round and take the app offline. The stall of the reader
below takes the app offline but leaves the round going: on a slow link the
round's own downloads are often what holds the reader up, and stopping the
round would throw away the files in flight at every page opened during the
first copy. A request of the round with no headers in 30 seconds counts as a
network error: a link that dies with no `offline` event leaves a fetch waiting
for minutes, and the round, still holding the lock, would block the next one
when the network is back. The deadline is longer than the 10 seconds a render
may take on the server, and only the headers have it, so a large file that has
started comes in whole. A 401 stops it until `/api/me` answers again, and
running out of space stops it with no new round until the app is opened again
or the switch turns it on. A redirected answer, a captive portal, or any other
surprise ends the round as failed. The tab of the round shows how it ended even
when the state record could not be written, which is likely when the space ran
out. The first round calls `navigator.storage.persist()`, and so does the
switch, inside the tap.

## Offline in the app

- `web/src/offline/connection.ts` decides. The app goes offline on a network
  error in the api client's `send()`, on any 5xx there that is not scrawl's own
  answer (a render deadline is a 503; Cloudflare's 521 to 530 say the server is
  down), and on the `offline` event. scrawl's own answer is one with
  `App-Name: scrawl`, which the server sets on every answer, its 401 too; a
  gateway's page has none, even in JSON. `navigator.onLine` alone is not
  trusted. While the copy is on, a page, folder or nav request of the reader
  with no headers in 3 seconds, the worker's wait, takes it offline too when
  the copy holds its answer: one bar of signal often keeps `onLine` true and a
  fetch hangs for minutes. The request is not cut; the reader leaves it for the
  copy. Without a stored answer the request waits for the network, as in the
  worker, so a note slow to render and not in the copy still opens. One in the
  copy goes offline for a moment and comes back at once: going offline probes
  `/ping` with no wait, and `/api/me` answers.
- A start from the offline shell while `navigator.onLine` is true is a check,
  not a failure: the app reads the copy, but shows no `Offline` mark, and
  `/edit/`, `/history/` and `/search` show nothing yet. The reader gets
  `checkingPlatform`, `offlinePlatform` whose source asks the network for a
  note, a folder or the tree the copy does not hold. The check ends online when
  `/api/me` answers, and offline on a network error or after 3 seconds; the
  probe below starts only then, and its first `/ping` waits 15 seconds, so a
  slow `/api/me` is not asked again at once. A `/ping` that answers asks it
  again, cutting the one in flight: `/api/me` reads only memory, so one that
  long behind a server that answers hangs on a dead connection.
- Offline it probes `/ping` every 15 seconds while visible and at once on the
  `online` event. `/ping` is public, so its answer proves only that the server
  is there; then the app asks `/api/me` in the foreground, and only an answer
  of `/api/me` makes it online again. A 401 there sends the person to sign in.
  An answer of `/ping` counts when it is scrawl's, a 2xx, a redirect, a 401 or
  a 403, so the sign-in below is reached from offline as well; a gateway's 5xx
  or another error does not. A captive portal on plain HTTP looks like a
  gateway: the app goes to sign in, and the portal shows its page there.
- A gateway with its own sign-in (Cloudflare Access, Authelia, oauth2-proxy)
  answers an ended session with a redirect, often to another site, a 401, a 403
  or its sign-in page. A fetch that follows a redirect to another site fails as
  a network error does, and the app would stay offline on the copy, never
  reaching the sign-in, since the worker serves the space's pages from the
  cache. So `/api/me` and `/ping` are asked with `redirect: 'manual'`, and an
  answer of `/api/me` with no `App-Name: scrawl` that is a redirect, a 401, a
  403 or a 2xx that is not JSON counts as a 401. Any other answer without the
  header, a 5xx of a gateway whose server is down above all, is not a sign-in.
  The app goes to `/login?from=`, which the worker leaves to the network, the
  gateway shows its sign-in there and then sends the person back, and `/login`
  sends them on to `from`, with auth off too. A tab goes there from such an
  answer at most once in 5 minutes, the time of the last trip kept in
  `sessionStorage` and cleared when `/api/me` answers: a gateway that refuses
  `/api/me` with a 403 even after its sign-in, while `/login` gets through,
  would reload the app forever, and the copy stays readable instead. A mark
  with no end would leave a person who left the gateway's page without signing
  in on the copy for as long as the tab lives, with no way to sign in, since
  the space menu hides Sign in on the copy. scrawl's own 401 is not limited:
  its sign-in page cannot loop, and a tab that came back from it with Back on
  the copy would otherwise stay there with no way to sign in.
- A 404 of `/api/me` while the app reads the copy means the server no longer
  has the space, renamed or removed, while the copy and its `/api/spaces` still
  do: `/` would keep sending the person there. The app asks `/api/spaces` and
  goes to the first other space; its `/api/me` answers, and the round there
  deletes the gone space from the copy.
- Offline the reader gets `offlinePlatform`: the app's platform with no search,
  no editing, and `offlineSource`, which reads `scrawl-data` directly and gives
  only answers whose release is the shell's `data-version`. The tree is the
  stored one, its branch marked by `markBranch`, which the site uses too.
- `NavProvider` gets the stored `me` with the space read-only, history off and
  the git sync fields empty, so every write control, history and the sync
  control go with no change to them. The search provider gives no control, the
  space menu reads the stored spaces and leaves out its `Read-only mode` row,
  export to a file is hidden (print stays), and so is "Sign out".
- `/edit/`, `/history/` and `/search` opened offline show `Needs a network`. An
  editor already open stays open, so no typed text is lost.

## Users

- One copy belongs to one user, `state.owner`; auth off is owner `""`.
- A successful sign-in, by the form or the api, also sets the cookie
  `scrawl_signin` with the user name: not `HttpOnly`, no max age, the path,
  `Secure` and `SameSite` of the session cookie. The app reads it when it
  starts, before any read of the copy, also where the switch is off but a copy
  is there, since an installed app and the browser share one: a name other than
  the owner deletes `scrawl-data` under the lock, writes the new owner and
  tells the other tabs, which stop their round and read the new state. The user
  a tab holds stays until its next `/api/me`, which the new session answers.
  Then the app deletes the cookie. So a new user who loses the network right
  after signing in never sees the copy of the one before.
- Sign out deletes `scrawl-data` under the lock and keeps the worker, the app
  cache and the choice: the app cache holds nothing of a user.
- The sign-in page deletes nothing, so the copy of a person whose session
  expired stays until someone signs in.

## Limits

- mtime and size miss a change that keeps both, the gap the `/raw/` ETag has.
- A link marked broken stays so until the note changes, as in the server's page
  cache.
- After an upgrade a note whose answer is not fetched again yet shows
  `This is not on this device` until the first round of the new release ends.
- Pictures from other sites are not copied.
- After an upgrade, a start from the copy runs the bundle of the app cache
  against the new server until the worker the start installs takes over. Then,
  once `/api/me` has named a release other than the shell's, the app reloads
  onto the new bundle, at most once a minute and not over unsaved text. While
  that install fails, for lack of space, every start runs the old one.
- The offline shell knows no theme, so with a picked theme other than the
  system's the start screen shows the system's ground until the bundle runs.
