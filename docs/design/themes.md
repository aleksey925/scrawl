# Themes

How a theme file becomes the colors of the app, a page and the code.

- A theme is one file in `internal/theme/themes/`, and nothing else names a
  color of one: adding a theme is a file and `make ui`. The file holds Notion's
  color roles, its nine block colors, six shadows, the weight of bold and that
  of the sidebar's current row, and how a Mac smooths the letters: the light
  theme keeps the system's own, as Notion's light page does, and the dark one
  draws them thinner, since light letters on a dark page glow; mantine's
  antialiased everywhere made the light page read thin beside Notion's. The
  server, the command line and the frontend build all read those files. The
  build turns every key into a `--scrawl-*` custom property in one stylesheet,
  which the app bundles, a page of the command line inlines and the sign-in
  page links as `app/themes.css`; `render` builds a chroma style from the six
  code colors each one lists; the server takes the list and the bar color.
  `light` and `dark` must exist, because they are what Auto follows.
- The keys of a theme file, whose name is its id: `name`, what the pickers
  show; `scheme`, `light` or `dark`, what the browser draws for a form control,
  and the editor and diagram defaults; `code`, six colors of code, `keyword`,
  `string`, `comment`, `function`, `number` and `builtin`; `strongWeight`, the
  weight of bold in a note; `currentWeight`, the weight of the current row of
  the sidebar; `fontSmoothing`, `auto` or `antialiased`; `palette`, every token
  of `Palette` in `web/src/themes.ts`, read as `--scrawl-<key>`; `blocks`, the
  nine block colors, a text and a ground each, as `--scrawl-color-<name>` and
  `--scrawl-bg-<name>`; `shadows`, `small`, `medium`, `large`, `capsule` and
  `capsuleGrouped`, the shadows of a phone's capsule on a white and on a gray
  page, `toastPhone`, that of a phone's toast, and `button`, that of a framed
  button such as the actions of the history on a desktop, as
  `--scrawl-shadow-<name>`; and `colors`, optional, which replaces mantine's
  `accent`, `gray` or `dark` scale of `web/src/theme.ts`. To add a theme, copy
  `light.json` or `dark.json`, change the values and run `make ui`. The go
  tests and the build both refuse a theme with a token missing. In both entries
  the theme stylesheet is imported after mantine's own: it replaces their
  defaults at equal specificity, so the order of the imports decides.
- The theme is one attribute, `data-scrawl-theme`, absent on Auto, where the
  system preference picks between `light` and `dark`. Every stylesheet keys on
  it, `theme.Scopes` and `themeStylesheet` place the rules the same way, and no
  theme is written as a plain default: two chroma styles do not paint the same
  tokens, so an unguarded rule follows the note into the other theme and turned
  the punctuation of a fence black on black. Mantine's
  `data-mantine-color-scheme` only follows as the theme's scheme, because
  mantine knows two schemes and two themes can share one. The app runs mantine
  with `withCssVariables={false}`: its runtime variables sit under its own
  attribute and would outrank a theme's. The picker reloads nothing, so it also
  puts the head on the theme: the bar color and the home screen icon, the light
  or the dark one, which the server writes per scheme behind the system
  preference on Auto.
- Colors come from the theme files alone, as `--scrawl-*` custom properties,
  the one family the note and the chrome both read, in the app, on the sign-in
  page and in a page of the command line; the fonts, the spacing and the shape
  of a control are the mantine theme's. A tap latches `:hover` onto what it
  landed on until the next tap somewhere else, so every decorative hover is
  gated on `@media (hover: hover)` and the platform tap highlight is off, once
  on the root in `web/src/global.css`.
