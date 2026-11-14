# 25. HTML apps run on an origin of their own

Status: accepted. Where it applies: [HTML apps](../design/html-apps.md),
[server](../design/server.md), [offline copy](../design/offline.md#html-apps),
[pages](../ui/pages.md#an-html-app).

## Context

A space often holds small web tools beside the notes: a calculator, a tracker,
a page another program exported. scrawl showed a `.html` file only as
highlighted source. The owner wants to run any such file as a small app, with
no change to the file, so that it works as a normal site with real
`localStorage`, IndexedDB, cookies and service worker, and with no network once
it ran with one. The app must not hurt scrawl: no session, no API as the
person, no notes. And running stays simple: one binary, one port, no proxy,
nothing new to set for a local run.

## Decision

- An HTML app is the folder of the file run, and it runs on a host of its own,
  `app-<id>.<domain>` from `APPS_URL` or `app-<id>.localhost` by default, in a
  frame under one bar of scrawl. The browser isolates it and gives it real
  storage.
- The server switches on the host before any middleware. The apps host has no
  sign-in and none of scrawl's routes; it serves only the web files of the
  folder named by a signed app cookie, which a one-time ticket of 60 seconds
  sets. The cookie carries the space and the folder, so the server keeps no
  table.
- The parent origin is the `Origin` header of the ticket's POST, checked
  against `Host`. `SameSite` of the app cookie follows the `Sec-Fetch-Site` of
  the enter request.
- The scrawl host lists the apps hosts in `frame-src` of every page and sends
  `Cross-Origin-Resource-Policy: same-origin`.
- The cookie threat, an app on a neighbor host planting a cookie for scrawl, is
  met by `__Host-` cookies on https, for the session and the sign-in name, an
  error at start when an `https` `APPS_URL` meets a session cookie that can
  never be `Secure`, and a warning at start on http. The local link scrawl logs
  is `127.0.0.1`, which is never a neighbor of an app host.
- Offline, an app is kept by a second worker of scrawl on the apps host, only
  while scrawl's offline copy is on and only in a same-site frame: in a
  cross-site frame Chromium's worker sends no cookie, so the local run at
  `127.0.0.1` and `localhost` is not kept. It keeps what the app loads and
  fetches the whole folder ahead, with one queue for every change of its cache.
  An app's own worker wins its scope.

## Options turned down

- A frame `sandbox` without `allow-same-origin` and a `localStorage` shim fed
  by `postMessage`: complex, writes can be lost on closing the tab, no
  IndexedDB, worker or real cookies, and the app can notice it. The same with
  the data on the server: shared by every device, and a sync XHR is deprecated.
- The same origin as scrawl: the app's script acts as the person on the whole
  API.
- A second port: behind a tunnel it needs its own hostname anyway.
- A `srcdoc` or `blob:` frame: it inherits scrawl's CSP, so the app's scripts
  do not run, and scrawl's origin.
- A `credentialless` frame: its storage goes when the page closes.
- A token in the path: it breaks links from the root.
- One host for all apps, each in a subfolder: the apps share storage and read
  each other's files, a link from the root leaves the folder, and offline needs
  a scope and a cache per path.
- A table from id to folder, filled by tickets or built from the tree: lost on
  a restart, or a walk of every space on every change.
- A parent origin from the request body: it could name any origin.
- `frame-src` only on the run screen: the app is one document across routes and
  starts from the cached offline shell, so the header would not reach it.
- A neighbor rule at the ticket endpoint, refusing Run when the hosts share a
  parent name on http: a shared-name test with no public suffix list, and it
  does not stop an app run from a safe address. A guard at `localhost` that
  refuses sign-in or sends it to `127.0.0.1`: new code on every request, and a
  person there loses the sign-in, the copy and the home screen app.
- Offline through scrawl's own copy: its worker never sees a request of another
  origin. A `srcdoc` frame fed from the copy: scrawl's CSP and origin again.
  Asking the app to bring its own worker: the app must not change.
- A reserved worker file at the root of the app, such as `/__scrawl-sw.js`, or
  a scope under a prefix: one puts scrawl's file among the app's paths, the
  other breaks links from the root. The script sits under `/__scrawl/` with
  `Service-Worker-Allowed: /` instead.
- Keeping only what the app loads, or only fetching the folder ahead: the first
  misses a page not shown yet, the second leaves nothing to a person who lost
  the network just after the first run.
- A bound on the folder: two constants and another answer of the list for a
  case one line of the README covers.
- A digest of the folder in the enter URL: the list with its ETag does the same
  in one request.
- `Clear-Site-Data` on a 401: `"storage"` deletes the app's own data with the
  files, `"cache"` reaches no worker's cache.
- A stored `frame-ancestors`: a file not fetched again keeps the parent of its
  first run.
- A generation number alone for the purge: a worker stopped and started again
  forgets it.
- Taking the scope back from an app's own worker: the two would swap on every
  run, and a waiting worker of the app would be replaced.
