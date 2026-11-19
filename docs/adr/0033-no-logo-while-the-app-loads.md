# 33. No logo while the app loads

Status: accepted. Where it applies: [pages](../ui/pages.md#start). It replaces
the logo drawn while the app loads of
[ADR 24](0024-the-app-starts-from-the-copy.md).

## Context

The server drew the logo on the theme's ground inside the mount node, and the
router's `HydrateFallback` drew the same, so the screen was never empty while
the app loaded.

## Decision

Until the first page is drawn, the screen is the theme's ground with nothing on
it: the server leaves the mount node empty, and the router's `HydrateFallback`
draws nothing. The offline shell knows no theme and draws the system's ground
until the bundle runs.

## Options turned down

- The logo in the middle of the ground while the app loads: it showed on every
  start, even a short one, as a splash screen the app does not need.
