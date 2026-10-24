# Themes

How a theme file becomes the colors of the app, a page and the code.

- A theme is one file in `theme/themes/`, and nothing else names a color of
  one: adding a theme is a file and `make ui`. The file holds Notion's color
  roles, its nine block colors, three shadows, the weight of bold and that of
  the sidebar's current row, and how a Mac smooths the letters: the light theme
  keeps the system's own, as Notion's light page does, and the dark one draws
  them thinner, since light letters on a dark page glow; mantine's antialiased
  everywhere made the light page read thin beside Notion's. The server, the
  command line and the frontend build all read those files. The build turns
  every key into a `--scrawl-*` custom property in one stylesheet, which the
  app bundles, a page of the command line inlines and the sign-in page links as
  `app/themes.css`; `render` builds a chroma style from the six code colors
  each one lists; the server takes the list and the bar color. `light` and
  `dark` must exist, because they are what Auto follows.
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
  gated on `@media (hover: hover)` and the platform tap highlight is off.
