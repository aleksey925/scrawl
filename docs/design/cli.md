# Command line

The markdown tools beside `serve`, the pages they write, and the export.

- The server is one command, `serve`, and the rest of the binary is markdown
  tools on files the caller names: `render`, `site`, `diff`, `format`,
  `stylesheet`. They run the renderer, `htmldiff`, the formatter and the
  PlantUML engine the server runs and add nothing to them, so a note reads and
  compares the same in the app and out of it. Outside the app a relative link
  stays as written, because there is no route to map it onto, and `--link-ext`
  swaps `.md` for a site. `diff` takes revisions the way `git diff` does and
  answers like it: 1 is "the text changed" under `--exit-code`, so a failure
  is 2.
- A page of `render` and `diff` is one file that opens on its own. Its
  stylesheet is the app's: `web/vite.themes.ts` evaluates the theme with
  mantine's own resolver at build time, so the page has the same custom
  properties with no mantine and no copied value. The theme follows the system
  until a button picks one, under the attribute the app uses. KaTeX is inlined
  on `--math` with woff2 alone, a quarter of what katex ships; mermaid is not,
  a 5MB script, and its diagram stays code. A PlantUML diagram is drawn by the
  server's engine and becomes a picture, in every format of `render`
  ([server](server.md#plantuml)). A diagram the engine refuses stays code with
  the reason under it. One the engine could not draw at all stays code with the
  note that it could not be rendered, and `render` writes a line to stderr that
  starts with `scrawl render: a plantuml diagram is left as code:`, but still writes the page
  and exits with 0. `diff` keeps a diagram as code, as a changed one carries
  the words of both versions.
- An exported note is that page, its PlantUML diagrams drawn. `/api/export/`
  renders it the way `render` does, links left as written, and carries the
  space's pictures inside as data URLs up to a budget: the file leaves the
  server, and a relative picture would stay behind. A PDF is a print of the
  note on screen ([ADR 14](../adr/0014-pdf-is-a-print.md)). Paper is always the
  light theme, since a browser drops the page background. The export menu
  switches the theme for real and waits for the formulas and for the diagrams
  to be drawn again; the browser's own print only swaps the attributes, because
  `beforeprint` leaves no time for a redraw. A printed page has no margin,
  which leaves the browser no room for the address and the date it writes
  there; the body's padding, repeated on every page, stands in for it. Safari
  cannot repeat a block's padding and keeps the page margin, or every page
  break would run to the edge of the paper, and so does a diff: the size
  containment its columns are laid out by keeps it from being split, so no
  padding would repeat on its pages either. The page with no margin is set on
  every element of the body and not on the body alone: on the body alone
  Firefox gave the margins back from the third page.
