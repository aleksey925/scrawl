# Site

A space written out as static pages that run the app's reader.

- A site is a space shown read-only, with no server, and it is the app's reader
  and not a second one ([ADR 15](../adr/0015-site-runs-the-app-reader.md)). The
  reader is one set of components run from two entries: the app's, against the
  server, and a site's, against the answers `site` wrote into its pages. What a
  reader can do without a server reaches a site by being in the reader.
- The reader asks the place it runs in for everything that differs: the
  answers, the physical urls, which link it routes, the two renderers and where
  a choice is kept. That is the platform, given by each entry. What only the
  app does - writes, history, sync, the account, the spaces, search - is
  plugged into the reader by the app and never imported by it, and the build of
  a site fails when the reader reaches any of it, so the reader cannot grow a
  dependency on the server unnoticed.
- A site's answers are the server's. The JSON shapes and their builders live in
  `view`, which the handlers and `site` both call, so a page describes a note
  exactly as `/api/page/` would; HTTP caching, auth and the space's state stay
  in the handlers. Each page carries its own answer, and the tree is one shared
  `scrawl/tree.js`: written into every page it grew with the square of the
  notes. A page holds its note twice, in the answer and as markup a reader
  without javascript reads together with the path and what its folder holds.
  Taking the note back out of that markup would parse sanitized HTML a second
  time.
- From a host a site moves between notes the way the app does: the next page is
  read and its answer shown, with no page load, so the tree, its filter and its
  scroll stay where they were. The page is the one copy of its answer, so
  nothing else is written for this. Back puts each note where it was left,
  which the browser cannot do for a page it never loaded, and a page that
  cannot be read is loaded instead. From disk a page can fetch nothing and
  cannot put another file in the address bar, so there every move to another
  note is a page load; only a fragment or a query stays on the page either way.
  A page opened from disk can load no module, so the reader is one classic
  script, the data are scripts that hand themselves over, and mermaid, PlantUML
  and KaTeX are files of their own that a page loads only when its note needs
  them. Of PlantUML's library a site gets the files its notes include, with
  what those include in turn, in `scrawl/plantuml/`: a whole library is up to
  17MB. The scan reads the whole note, not only its diagrams, so an include
  quoted in another block ships its library too: a file missing breaks a
  diagram, one too many only takes space. An include can name its library
  through a variable, as in `!include <$lib/C4>`; the scan then takes every
  value the note gives that variable in a line like `!$lib = "C4"`, with
  `!global`, `!local` or `?=` too. A name built any other way, by a function or
  from other variables, is not followed, and its diagram draws on a site only
  if another include ships the same library. The scan also ships `themes.js`
  for a `!theme` line, `openiconic.js` for an icon like `<&heart>` and
  `emoji.js`, 1.8MB, for an emoji like `<:smile:>`. Any library brings
  OpenIconic, 12KB, as a library can build an icon while it runs, as C4 does
  from `$sprite="&person"`. A folder is `index.html`, its list, written for
  every folder, and its `index.md` is `index.md.html`. A relative link to a
  folder points to the list, because opened from disk a folder is the system's
  listing, and one to `index.md` to the note's page. Opened from disk, a page
  in Firefox has the origin `null`, so a heading's link is built without it,
  and the script finds the folder of the renderers from
  `document.currentScript`, which is set only while the script runs, so it is
  read when the script loads.
- A site has one look, and its only settings are the reader's theme and page
  width; nothing `site` copies is changed. The front page is the root's list,
  Home opens the root `index.md`, and the site takes its title from that note.
  The scripts are written once into `scrawl/` and not `_scrawl/`, which the
  Jekyll of GitHub Pages drops. The theme and the page width are kept in a
  cookie and in the storage both: from disk Firefox shares only the cookie
  between pages and Chromium only the storage; the open folders are kept in the
  storage alone, so in Firefox from disk only the way to the note is open. A
  page the browser brings back on Back takes the theme picked since and closes
  its sheet. A copied file a browser runs a script from is named when it is
  written, because on a host nothing gives it the headers `/raw/` gives it.
- The store decides what a site lists: `site` walks the notes through it, so a
  site publishes what the app would serve and nothing a dot or `--exclude`
  hides. The site's tree leaves out a folder with no note in it, which the
  app's keeps to create a page in; the folder still has its page.
