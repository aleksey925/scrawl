# 15. A site runs the app's reader

Status: accepted. Where it applies: [site](../design/site.md).

## Context

A site is a space shown read-only, with no server. It once had a reader of its
own, written as Go templates, and every fix to the app's reader was missing
from it: no outline on a phone, nothing marked while reading, a tree that
forgot its folders.

## Decision

The reader is one set of components run from two entries: the app's, against
the server, and a site's, against the answers `site` wrote into its pages.

## Consequences

- What a reader can do without a server reaches a site by being in the reader.
- The reader asks the place it runs in for everything that differs, and the
  build of a site fails when the reader imports anything only the app has.
- A site's answers are built by the same code in `view` as the server's.
