# 24. With offline access on, the app starts from the copy

Status: accepted. Where it applies: [offline copy](../design/offline.md),
[pages](../ui/pages.md). It replaces the network-first navigation of
[ADR 23](0023-offline-copy-by-a-worker-and-the-reader.md).

## Context

An installed app on an iPhone that the system took out of memory opened to a
long black screen. The worker sent the page's navigation to the network and
waited up to 3 seconds for it, twice from the home screen: once for `/`, once
for the space. The shell was empty until the bundle ran, and the router drew
nothing while the first page's chunk loaded. The reader then asked the network
again, with its own 3 seconds.

## Decision

- A navigation of a space the copy holds gets the offline shell from the cache,
  with no network, and so does `/`. The app starts on the copy and goes online
  when `/api/me` answers.
- That start is a check, not offline: no `Offline` mark, and what the copy does
  not hold comes from the network. It ends offline on a network error or after
  3 seconds.
- A navigation while `scrawl_signin` is set, or of a space whose `me` the copy
  does not hold, still goes to the network first.
- The server draws the logo on the theme's ground inside the mount node, and
  the router's `HydrateFallback` draws the same, so the screen is never empty.
  The offline shell knows no theme and draws the system's ground until the
  bundle runs.

## Options turned down

- The navigation network-first and the reader showing the copy first: the page
  still waits for the server before anything is drawn, the longest wait.
- Navigation preload: it starts the request sooner but still waits for it.
- `apple-touch-startup-image`: one picture per screen size and orientation.
- Starting offline with the mark shown: the mark would flash on every start.
- Ending the check by cancelling `/api/me`: on a slow link the account would be
  asked again and again and never answer in time.
- A cached shell kept only for an installed app: the worker cannot see the
  display mode, and a browser with the switch on has the same wait.
