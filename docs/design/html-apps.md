# HTML apps

How a `.html` file of a space runs as a small app: on a host of its own, in a
frame under one bar of scrawl, with its own storage, and offline. In the docs
and the code "the app" is scrawl's own frontend and "an HTML app" is a user's
file run this way; the code says `htmlapp`. Why it is built this way:
[ADR 25](../adr/0025-html-apps-on-their-own-origin.md).

## The threat

- An HTML app is any script someone put into a space. It runs on an origin of
  its own, so it gets no session cookie, cannot call the API as the person and
  cannot read the notes. The apps host serves only the web files of the app's
  folder.
- What it can still do, only with auth on: when its host is a cookie neighbor
  of scrawl's host, it can plant a cookie for scrawl (cookie tossing). Two
  hosts are neighbors when they share a parent name: `localhost` and
  `app-x.localhost`, `notes.home.lan` and `app-x.home.lan`. An IP is never a
  neighbor of a name. A planted cookie can sign the person out or into another
  account, and with two people in one browser the offline copy may show one
  person's notes to the other. It never reads a note or calls the API.
- On https this is closed by `__Host-` cookies, which no other host can set or
  replace (the scrawl host, below). On http nothing in a cookie closes it; the
  only defense is that scrawl and the apps are not neighbors. Plain http on a
  network shows the password to anyone on it anyway, so there is no check per
  request, only the checks at start below.

## The setting

- One server flag, `--apps.url` (`APPS_URL`), never a key of the spaces file:
  - empty, the default: the local mode (below);
  - a URL with `{id}` in its first label, `https://app-{id}.example.com`: a
    host per app.
- `htmlapp.Parse` checks it at start: `http` or `https`, no user, query,
  fragment or path, exactly one `{id}`, in the first label, with only
  `[a-z0-9-]` beside it. A URL without `{id}` stops the start with a message
  that shows the form. One host for all apps, each in a subfolder, is not
  supported: apps on one host share one origin, so they share storage and read
  each other's files, a link from the root leaves the app's folder, and offline
  needs a scope and a cache per path.
- Auth on, an `https` `APPS_URL`, and a session cookie that can never be
  `Secure` stop the start. scrawl serves no TLS, so the cookie is `Secure` only
  with `--auth.secure=always`, or `auto` with `--trusted-proxy`;
  `--auth.secure=never` counts as never. The message names
  `--trusted-proxy (TRUSTED_PROXY=true)` first, the fix behind Cloudflare
  Tunnel. Every message of this part names the flag and the variable, since a
  Docker run sets the one and a run by hand the other.
- Auth on and the apps over http log one `[WARN]` line at start: the local mode
  says to open scrawl at the `127.0.0.1` link, an `http` `APPS_URL` says not to
  put scrawl and the apps on neighbor names. It also shows when the person uses
  the safe link, and with an `http` `APPS_URL` when scrawl itself is on https.
  With auth off there is no session to hurt, and neither check applies.

## The host switch

- `router()` looks at `r.Host` before any middleware. `Hosts.Match` takes the
  hostname, with no port, lowercased, no trailing dot:
  - a host per app: `<prefix><x><suffix>.<rest>` of the template;
  - the local mode: a first label `app-<x>` under `localhost` or `*.localhost`.
- A matching host is an apps request: for the id `x` when `x` has the shape of
  an id, else a 404 for every path. With `{id}` alone in its label, such as
  `https://{id}.example.com`, a host whose `x` is not an id is scrawl's, so
  scrawl at `notes.example.com` keeps working. Any other host is scrawl, as
  before, a foreign subdomain too: scrawl does not know its own host, and
  telling `notes.example.com` from `random.example.com` would need it as a
  setting.
- The apps stack is `rest.Trace`, `rest.Recoverer`, `appsHeaders`, `appName`,
  gzip, `rest.RealIP` with `--trusted-proxy`, its own throttle and the logger:
  no `Auth.Middleware`, no `appInfo`, no scrawl CSP. `rest.Throttle` counts per
  call, so an app that loads fifty files at once holds no slot of the notes.
- No handler of scrawl's host is mounted there. `/login`, `/static/`, `/api/`,
  `/sw.js`, `/ping` or `/s/<name>/` on an apps host is a path of the app, a
  file of its folder or a 404. Only `/__scrawl/` is reserved.
- `appsHeaders` sets `nosniff`, `Referrer-Policy: no-referrer`,
  `Cross-Origin-Resource-Policy: same-origin` and `App-Name: scrawl`, the mark
  the worker below reads, as the app reads it on scrawl's host. Never
  `X-Frame-Options`: `frame-ancestors` is set per answer.
- The apps routes exist only when the server has an auth service, which only
  tests leave out.

## The id

- An HTML app is the folder of the file run: every HTML file of one folder
  shares a host and its storage, as pages of one site do, and a file as the app
  would split a multi-page app into many origins.
- The id is the first 12 characters of lowercase base32 of
  `sha256(space + "\x00" + folder)`, `""` for the root: `[a-z2-7]`, 60 bits,
  valid in a DNS label. The hash has no key: the browser keeps an app's data by
  its origin, and a key rotation would lose it.
- The server keeps no table from id to folder. The app cookie carries the space
  and the folder, signed, and a request must have `ID(space, folder)` equal to
  the id of its host. Nothing is built from the tree, nothing is lost on a
  restart, and a rename needs no update. A rename of the space or the folder is
  a new origin, and the data in the browser stays at the old one.

## The ticket and the cookie

- `auth.Service` seals and opens them, so every secret stays in `auth`: the key
  is `HMAC(secret, "scrawl/" + purpose)`, so a ticket is never a cookie and
  neither is ever a session, and the MAC mixes the user's epoch, so a changed
  password or a removed user ends both. With auth off the service keeps a
  random key in memory; after a restart an old app cookie is refused and the
  run screen asks again.
- A ticket (`app-ticket`) lives 60 seconds and holds the space, the folder, the
  file, the parent origin, the app origin, a nonce and `offline`. It is good
  once: the apps handler keeps the nonces it took in a map, dropping the
  expired ones. It travels in a URL that a proxy logs, so once taken it is
  worth nothing.
- The app cookie (`app-cookie`) lives as long as a session and holds the space,
  the folder and the parent origin. It is `__Host-scrawl_app` with an `https`
  `APPS_URL`, else `scrawl_app`: `Path=/`, `HttpOnly`, never `Domain`.
  `SameSite` follows the `Sec-Fetch-Site` and `Sec-Fetch-Dest` of the enter
  request, which say how the scrawl page relates to this host: a `cross-site`
  `iframe` gets `SameSite=None; Secure; Partitioned`, anything else `Lax`,
  `Secure` on https. Open in a new tab is a `document`, a first party, so it
  keeps `Lax`, which also works over plain http, where a browser refuses a
  `Secure` cookie at a name other than `localhost`. So the server needs no
  public suffix list, and a same-site deployment never relies on third-party
  cookies. Sign-out does not end it; the TTL, a password change or a removed
  user do.

## The ticket endpoint

`POST /s/<name>/api/run/<path>`, under `CSRF()`, body `{"offline": bool}`,
answers `{"url": "<app origin>/__scrawl/enter?t=...", "app": "<file URL>"}`
with `no-store`:

- a `Bearer` token gets 403: a ticket ends in a browser cookie, which a script
  has no use for, and this keeps `:ro` tokens out too;
- the path must be a file ending in `.html` or `.htm`, in any case;
- the parent origin is the `Origin` header, an `http` or `https` origin with a
  plain hostname or an IP and a numeric port, equal to `r.Host`, else 403. With
  `CSRF()`, which refuses every `Sec-Fetch-Site` but `same-origin` and `none`,
  it is the origin of a scrawl page set by the browser. A value from the body
  could name any origin;
- the app origin comes from the template, or the local mode below. A refused
  address, and an app hostname equal to the parent's (cookies ignore the port,
  and the frame could reach the page), answer 409 with a text that names the
  reason and the fix.
- It writes nothing, so read-only does not refuse it. The run screen is reached
  from every `.html` and `.htm` file: `writeFile` sets `run_url` in every
  branch. Where Run cannot work, the run screen shows the 409.

## The apps host

`GET` and `HEAD` only, anything else 405.

- `/__scrawl/enter?t=` opens the ticket and checks it: not expired, the host of
  the request is the ticket's app host, the nonce not taken; else 401
  `This link has expired. Open the app from scrawl again.`. The space must
  still exist. It sets the cookie and answers a small page with no inline
  script, `default-src 'none'; script-src 'self'; frame-ancestors <parent>`,
  `no-store`, whose `<body>` carries `data-file`, `data-parent` and
  `data-offline`, and whose one script, `/__scrawl/enter.js`, does the offline
  part and then moves the frame to the file with `location.replace`, so the
  used ticket stays out of the frame's history. A redirect would leave no
  moment to register a worker. `data-offline` is the ticket's, but always
  `false` for a `cross-site` enter request of a frame ([offline](#offline)).
- `/__scrawl/enter.js` and `/__scrawl/sw.js` are built from `web/src/htmlapp/`,
  public, `text/javascript`, `no-cache`. Only `sw.js` carries
  `Service-Worker-Allowed: /`.
- `/__scrawl/files` lists the folder for the worker, with the cookie checked as
  for a file: every file of the folder and its subfolders with a type on the
  list below, from `Store.Tree()`, each with the ETag its own answer carries.
  Files under the folder's own `__scrawl/` are left out, since no request
  reaches them. A folder gone is an empty list.
- Any other path is a file. No cookie, or the cookie of another app, is a 401
  as plain text with no `frame-ancestors`, so the person reads it in the frame:
  `Open this app from scrawl. If you just did, this browser did not keep the app's cookie inside the frame: open it in a new tab.`
  Every other answer carries `frame-ancestors <parent>` and nothing else in the
  policy: apps use inline scripts and CDNs. The path is cleaned as a rooted
  path, so `..` cannot climb, and joined to the folder; a path under
  `/__scrawl/` that is not a route is a 404. A path ending in `/` serves its
  `index.html`, a folder without the slash is a 301, and no folder is listed.
  `Store.Open` refuses a dot name, an excluded name and a symlink as
  everywhere. `private, no-cache` and the `/raw/` ETag, so an edit shows on the
  next load and the check is cheap.
- The types come from `htmlapp.ContentType`, not `rawContentType`, which serves
  `.js` as text, which `nosniff` would refuse: html, js, mjs, css, json, map,
  webmanifest, wasm, txt, csv, xml, pictures, svg, fonts, mp3, wav, ogg, mp4
  and webm. `.md` is not on it, so an app at the root of a space never reads a
  note.

## The scrawl host

- The CSP has `frame-src` for the apps hosts on every page, not only the run
  screen: the app is one document across routes and often starts from the
  cached offline shell, so a header set on one route never reaches it. A host
  per app gives `<scheme>://*.<rest>[:port]`, CSP having only a leftmost `*.`;
  the local mode gives `http://*.localhost:* https://*.localhost:*`. The price
  is small: no note can carry a frame, and `script-src 'self'` stops an
  injected script, so only scrawl's own code makes frames. The policy is also
  hashed into the offline shell's name ([offline copy](offline.md)).
- `Cross-Origin-Resource-Policy: same-origin` on every answer. An app on a
  sibling subdomain is same-site, so the `Lax` session cookie would go with its
  `<img src=".../raw/...">`; CORP stops that embed. With the apps host serving
  only the folder, an app uses the web files of its folder and anything on the
  internet, never another file of scrawl.
- When `secureFor(r)` is true the session cookie is `__Host-scrawl_session`.
  `session` reads only the name of the request's mode: a fallback to the plain
  name is what a tossed cookie would use. A sign-in then sets
  `__Host-scrawl_signin` and the plain `scrawl_signin` beside it
  ([offline copy](offline.md#users)).
- CSRF needs no change: a POST from an app on a sibling host carries
  `Sec-Fetch-Site: same-site` and is refused. No GET of the scrawl host writes.

## The local mode

With no `APPS_URL` the app host follows the address scrawl is opened at, with
the scheme and the port of the page. Chrome and Firefox send every
`*.localhost` name to the loopback themselves.

- At `127.0.0.1` the app is `app-<id>.localhost`. An IP is never a cookie
  neighbor, so Run is safe with auth on. The frame is cross-site, so its cookie
  is the partitioned one, and the frame's storage is apart from the storage of
  the app in a tab of its own. This is the link scrawl logs at start
  ([server](server.md#lifecycle)).
- At `localhost` or `*.localhost` the app is `app-<id>.<page host>`. At
  `localhost` the frame is cross-site too; at `scrawl.localhost` it is
  same-site, as on a real domain. With auth on these are neighbors, which the
  warning at start names.
- At any other address the run screen shows the 409: on this machine the
  printed link, from another device https with `APPS_URL`. `[::1]` is one of
  them, and with `APPS_URL` set any IPv6 address gets the 409 as well: a CSP
  source cannot name an IPv6 address, so `frame-ancestors` could not let the
  app in its frame. No code is added for a browser that does not open
  `app-<id>.localhost`, nor for a LAN address on http; such a frame shows the
  browser's error page.

## Offline

An app with no files, or with all its files in its folder, opens with no
network once it ran with one, and keeps its data. Only while scrawl's offline
copy is on in that browser: the copy's switch stays the one place that turns
offline on and off, and with it off nothing of an app is kept. scrawl's own
worker never sees a request of another origin, so a second worker of scrawl on
the apps host keeps the files.

- Only a same-site frame is kept: a real domain with `APPS_URL`, or
  `scrawl.localhost`. In a cross-site frame Chromium registers the worker but
  sends no cookie on its fetches, so every request of the worker got a 401
  ([quirks](../quirks.md#browsers)). The enter route therefore sends
  `data-offline="false"` for a `cross-site` enter request of a frame: the local
  run at `127.0.0.1` and at `localhost` works online and is never kept in the
  frame, and offline its run screen says
  `This browser does not keep this app for offline use.`. Open in a new tab is
  a first party there, so it keeps the app in that tab.
- The worker is `/__scrawl/sw.js` with the scope `/`, so it sees every request
  of the app. A worker's scope is no wider than its script's folder without
  `Service-Worker-Allowed`, so that script alone gets the header; a file of the
  app never does, and an app's own worker keeps the scope its path gives.
- The enter page, with `offline`, leaves the scope alone when any of its
  `installing`, `waiting` or `active` workers runs another script: the app's
  own worker owns its offline mode, and a `register()` of scrawl's script would
  replace a worker of the app waiting behind scrawl's. Else it registers the
  worker, waits for it to be active and posts `refresh` with the parent, all
  within 3 seconds, a wait of the first run only. Without `offline` it posts
  `off` to scrawl's worker, unregisters it unless the app's own is there, and
  deletes the cache: Off reaches an app on its next run with a network. Then it
  tells the parent `{type: 'scrawl-htmlapp', offline}`, with the parent as the
  target, and moves on to the file. `offline` is false without `offline` in the
  page, else true when the scope `/` has a worker, installing, waiting or
  active: a first install longer than 3 seconds still counts.
- The cache is `scrawl-htmlapp`, with a record `{parent}` under
  `/__scrawl/kept`. One key per file: the path with the query dropped, made
  canonical as `canonicalPath` of `keys.ts`, `index.html` added to a trailing
  `/`; a path of the list is escaped with `encodeContentPath` first, since
  `canonicalPath` decodes. So `/`, `/index.html` and `/index.html?v=2` are one
  file, and `a%20.html` and `a .html` are two.
- It keeps both what the app loads and the whole folder: kept on request only,
  a page not shown yet is missing; fetched ahead only, a person who loses the
  network right after the first run has nothing. A `GET` goes to the network at
  once and its answer is handled under `waitUntil` whatever the page got: a 200
  with no `Range` is stored when its ETag changed. The page gets the stored
  answer on a network error, a 5xx that is not scrawl's, or no headers in 3
  seconds; unlike `networkFirst` of the copy's worker, a late 401, 404 or new
  file still changes the cache.
- `refresh` writes the parent into the record, asks the list, fetches what is
  missing or changed four at a time, by the ETag of each file, and deletes what
  left the list. The list has no ETag of its own: comparing the ETags of the
  stored files costs little, and a list version would need its own rules for a
  refresh cut short. There is no bound: when the browser has no room the
  refresh stops with no message and the next run goes on.
- Every change of the cache runs in one promise chain, and a write goes only
  into a cache that exists, which only a refresh creates. Refreshes run one
  after another, each with its own `AbortController`. A purge, on scrawl's 401
  or on `off`, aborts them all and queues the delete, so a write that came just
  before it never lands after it, and a worker Off unregistered that still
  answers an open tab writes nothing. A generation number alone would not do: a
  worker stopped and started again forgets it.
- From the cache it answers with the stored headers but sets
  `frame-ancestors <parent>` from the record: a file unchanged since its first
  run is never fetched again, and a stored header would keep that run's parent.
  A `Range` request gets a 206 from the stored body. With no network, a folder
  without the slash whose `index.html` is kept is a 301 to the slash, as the
  server answers it. A file never kept, with no network, is a 504
  `This file is not on this device. Open the app once with a network.`.
  `/__scrawl/` always goes to the network, and requests of other origins are
  not touched: files of a CDN are not kept.
- scrawl's own 401 purges every stored file of the app and passes the 401 on,
  unless the request was sent with `credentials: 'omit'`: that one carried no
  cookie, so its 401 says nothing of the session; scrawl's 404 deletes that
  key. The app's own data, `localStorage`, IndexedDB and its cookies, is never
  touched: it belongs to the app and must outlive an offline period.
  `Clear-Site-Data` cannot tell the two apart.
- Offline there is no cookie check, as for a note of the copy, so an app kept
  opens after its cookie ended until the first request that reaches the server.
  `frame-ancestors` and the cookie's expiry hold for answers from the network
  only, not for an app's own worker, and offline not for scrawl's either.
  Sign-out leaves an app's files and data in the browser; no page of scrawl can
  reach another origin.
- The run screen keeps the record of a run in the copy, see
  [offline copy](offline.md#html-apps).
