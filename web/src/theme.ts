import {
  ActionIcon,
  Burger,
  Button,
  CloseButton,
  createTheme,
  type MantineColorsTuple,
  type MantineThemeOverride,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';

import breakpointValues from './breakpoints.json';
import controls from './controls.module.css';

export type BreakpointName = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export const breakpoints: Record<BreakpointName, string> = breakpointValues;

const pxPerEm = 16;

function emToPx(value: string): number {
  return Number.parseFloat(value) * pxPerEm;
}

export const breakpointPx: Record<BreakpointName, number> = {
  xs: emToPx(breakpoints.xs),
  sm: emToPx(breakpoints.sm),
  md: emToPx(breakpoints.md),
  lg: emToPx(breakpoints.lg),
  xl: emToPx(breakpoints.xl),
};

export function minWidthQuery(name: BreakpointName): string {
  return `(min-width: ${breakpoints[name]})`;
}

export function maxWidthQuery(name: BreakpointName): string {
  return `(max-width: ${Number.parseFloat(breakpoints[name]) - 1 / pxPerEm}em)`;
}

export function useAtLeast(name: BreakpointName): boolean {
  return useMediaQuery(minWidthQuery(name), true, { getInitialValueInEffect: false });
}

export function useBelow(name: BreakpointName): boolean {
  return !useAtLeast(name);
}

export const layoutBreakpoints = {
  sidebar: 'md',
  tocRail: 'lg',
  compactTopbar: 'sm',
  // two panes side by side, or one above the other
  splitPane: 'md',
  // the editor's splitter, or a tab per pane
  editorSplit: 'md',
} as const satisfies Record<string, BreakpointName>;

export const layout = {
  sidebarWidth: 264,
  tocWidth: 240,
  contentMeasure: 740,
  topbarHeight: 52,
  topbarHeightCompact: 48,
  topbarIconSize: 18,
  tapTarget: 44,
  // the switcher names the space and then gets out of the way of the page
  // actions, which are what a phone topbar must never push off the row
  spaceSwitcherWidth: 130,
  // an input below 16px makes iOS zoom the page on focus and never zoom back
  inputFontSize: 16,
} as const;

// iconEdgeInset is the padding that puts the glyph of an icon button, not its
// 44px box, on the phone's 16px edge, where the text of the page starts
export function iconEdgeInset(glyphSize: number): string {
  return `calc(var(--mantine-spacing-lg) - (var(--scrawl-tap-target) - ${glyphSize}px) / 2)`;
}

// GitHub's Primer palette, read off github.com, under its own token names. The
// app and a rendered note are both painted from it, so the two cannot drift
// apart; a note reaches it as --gh-*, the way github-markdown-css names it
interface Palette {
  fgDefault: string;
  fgMuted: string;
  fgAccent: string;
  fgSuccess: string;
  fgAttention: string;
  fgDanger: string;
  fgDone: string;
  bgDefault: string;
  bgMuted: string;
  bgInset: string;
  bgNeutralMuted: string;
  bgAttentionMuted: string;
  bgAccentMuted: string;
  bgAccentEmphasis: string;
  // not a Primer token: the next step of its blue scale, for a filled hover
  bgAccentEmphasisHover: string;
  controlRest: string;
  controlHover: string;
  borderDefault: string;
  borderMuted: string;
  borderEmphasis: string;
  borderAccentMuted: string;
  borderAccentEmphasis: string;
  borderSuccessEmphasis: string;
  borderAttentionEmphasis: string;
  borderDangerEmphasis: string;
  borderDoneEmphasis: string;
}

const lightPalette: Palette = {
  fgDefault: '#1f2328',
  fgMuted: '#59636e',
  fgAccent: '#0969da',
  fgSuccess: '#1a7f37',
  fgAttention: '#9a6700',
  fgDanger: '#d1242f',
  fgDone: '#8250df',
  bgDefault: '#ffffff',
  bgMuted: '#f6f8fa',
  bgInset: '#f6f8fa',
  bgNeutralMuted: '#818b981f',
  bgAttentionMuted: '#fff8c5',
  bgAccentMuted: '#ddf4ff',
  bgAccentEmphasis: '#0969da',
  bgAccentEmphasisHover: '#0550ae',
  controlRest: '#f6f8fa',
  controlHover: '#eff2f5',
  borderDefault: '#d1d9e0',
  borderMuted: '#d1d9e0b3',
  borderEmphasis: '#818b98',
  borderAccentMuted: '#54aeff66',
  borderAccentEmphasis: '#0969da',
  borderSuccessEmphasis: '#1a7f37',
  borderAttentionEmphasis: '#9a6700',
  borderDangerEmphasis: '#cf222e',
  borderDoneEmphasis: '#8250df',
};

const darkPalette: Palette = {
  fgDefault: '#f0f6fc',
  fgMuted: '#9198a1',
  fgAccent: '#4493f8',
  fgSuccess: '#3fb950',
  fgAttention: '#d29922',
  fgDanger: '#f85149',
  fgDone: '#ab7df8',
  bgDefault: '#0d1117',
  bgMuted: '#151b23',
  bgInset: '#010409',
  bgNeutralMuted: '#656c7633',
  bgAttentionMuted: '#bb800926',
  bgAccentMuted: '#388bfd1a',
  bgAccentEmphasis: '#1f6feb',
  bgAccentEmphasisHover: '#388bfd',
  controlRest: '#212830',
  controlHover: '#262c36',
  borderDefault: '#3d444d',
  borderMuted: '#3d444db3',
  borderEmphasis: '#656c76',
  borderAccentMuted: '#388bfd66',
  borderAccentEmphasis: '#1f6feb',
  borderSuccessEmphasis: '#238636',
  borderAttentionEmphasis: '#9e6a03',
  borderDangerEmphasis: '#da3633',
  borderDoneEmphasis: '#8957e5',
};

export interface ScrawlTokens {
  bg: string;
  bgSubtle: string;
  bgInset: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentEmphasis: string;
  accentEmphasisHover: string;
  accentSubtle: string;
  accentBorder: string;
  control: string;
  controlHover: string;
  danger: string;
  success: string;
  warning: string;
}

function scrawlTokens(palette: Palette): ScrawlTokens {
  return {
    bg: palette.bgDefault,
    bgSubtle: palette.bgMuted,
    bgInset: palette.bgInset,
    text: palette.fgDefault,
    textSecondary: palette.fgMuted,
    textTertiary: palette.fgMuted,
    border: palette.borderDefault,
    borderStrong: palette.borderEmphasis,
    accent: palette.fgAccent,
    accentEmphasis: palette.bgAccentEmphasis,
    accentEmphasisHover: palette.bgAccentEmphasisHover,
    accentSubtle: palette.bgAccentMuted,
    accentBorder: palette.borderAccentMuted,
    control: palette.controlRest,
    controlHover: palette.controlHover,
    danger: palette.fgDanger,
    success: palette.fgSuccess,
    warning: palette.fgAttention,
  };
}

export const lightTokens: ScrawlTokens = scrawlTokens(lightPalette);
export const darkTokens: ScrawlTokens = scrawlTokens(darkPalette);

// Primer's blue scale; the filled shades are set from the palette below
const accentShades: MantineColorsTuple = [
  '#ddf4ff',
  '#b6e3ff',
  '#80ccff',
  '#54aeff',
  '#218bff',
  '#0969da',
  '#0550ae',
  '#033d8b',
  '#0a3069',
  '#002155',
];

// Primer's neutrals in the order mantine reads them: gray from light to dark
// for the light scheme, dark from text to the deepest surface for the dark one
const grayShades: MantineColorsTuple = [
  '#f6f8fa',
  '#eff2f5',
  '#e6eaef',
  '#dae0e7',
  '#d1d9e0',
  '#c8d1da',
  '#818b98',
  '#59636e',
  '#393f46',
  '#25292e',
];

const darkShades: MantineColorsTuple = [
  '#f0f6fc',
  '#d1d7e0',
  '#b7bdc8',
  '#9198a1',
  '#3d444d',
  '#262c36',
  '#212830',
  '#151b23',
  '#0d1117',
  '#010409',
];

// GitHub's own stacks. github.com names "Mona Sans VF" first but ships no face
// for it, so what a reader sees there is the system font that follows
const sans =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"';
const mono = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

function tokenVariables(prefix: string, tokens: ScrawlTokens | Palette): Record<string, string> {
  const res: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens)) {
    res[`--${prefix}-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`] = value;
  }
  return res;
}

function mantineVariables(tokens: ScrawlTokens): Record<string, string> {
  return {
    '--mantine-color-body': tokens.bg,
    '--mantine-color-text': tokens.text,
    '--mantine-color-dimmed': tokens.textSecondary,
    '--mantine-color-error': tokens.danger,
    '--mantine-color-anchor': tokens.accent,
    '--mantine-color-default': tokens.control,
    '--mantine-color-default-color': tokens.text,
    '--mantine-color-default-border': tokens.border,
    '--mantine-color-default-hover': tokens.controlHover,
    '--mantine-color-placeholder': tokens.textSecondary,
    '--mantine-color-accent-filled': tokens.accentEmphasis,
    '--mantine-color-accent-filled-hover': tokens.accentEmphasisHover,
    '--mantine-color-accent-light': tokens.accentSubtle,
    '--mantine-color-accent-light-hover': tokens.accentSubtle,
    '--mantine-color-accent-light-color': tokens.accent,
    '--mantine-color-accent-outline': tokens.accentBorder,
    '--mantine-color-accent-outline-hover': tokens.accentSubtle,
  };
}

export interface ThemeCssVariables {
  variables: Record<string, string>;
  light: Record<string, string>;
  dark: Record<string, string>;
}

export function cssVariablesResolver(): ThemeCssVariables {
  return {
    variables: {
      '--scrawl-sidebar-width': `${layout.sidebarWidth}px`,
      '--scrawl-toc-width': `${layout.tocWidth}px`,
      '--scrawl-content-measure': `${layout.contentMeasure}px`,
      '--scrawl-tap-target': `${layout.tapTarget}px`,
      '--scrawl-input-font-size': `${layout.inputFontSize}px`,
    },
    light: {
      ...tokenVariables('scrawl', lightTokens),
      ...tokenVariables('gh', lightPalette),
      ...mantineVariables(lightTokens),
    },
    dark: {
      ...tokenVariables('scrawl', darkTokens),
      ...tokenVariables('gh', darkPalette),
      ...mantineVariables(darkTokens),
    },
  };
}

export const theme: MantineThemeOverride = createTheme({
  primaryColor: 'accent',
  primaryShade: { light: 5, dark: 5 },
  colors: { accent: accentShades, gray: grayShades, dark: darkShades },

  fontFamily: sans,
  fontFamilyMonospace: mono,
  headings: {
    fontFamily: sans,
    fontWeight: '600',
    sizes: {
      h1: { fontSize: '2.375rem', lineHeight: '1.2' },
      h2: { fontSize: '1.5rem', lineHeight: '1.3' },
      h3: { fontSize: '1.1875rem', lineHeight: '1.3' },
      h4: { fontSize: '1.0625rem', lineHeight: '1.3' },
      h5: { fontSize: '0.9375rem', lineHeight: '1.3' },
      h6: { fontSize: '0.875rem', lineHeight: '1.3' },
    },
  },
  fontSizes: {
    xs: '0.75rem',
    sm: '0.875rem',
    md: '0.9375rem',
    lg: '1.0625rem',
    xl: '1.1875rem',
  },
  lineHeights: { xs: '1.2', sm: '1.3', md: '1.45', lg: '1.55', xl: '1.65' },

  radius: { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '999px' },
  defaultRadius: 'md',

  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '0.75rem',
    lg: '1rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '2rem',
    '4xl': '2.5rem',
    '5xl': '3rem',
    '6xl': '4rem',
  },

  breakpoints,

  shadows: {
    xs: '0 1px 2px rgba(0, 0, 0, .04)',
    sm: '0 1px 3px rgba(0, 0, 0, .06), 0 1px 2px rgba(0, 0, 0, .04)',
    md: '0 4px 12px rgba(0, 0, 0, .08), 0 1px 3px rgba(0, 0, 0, .05)',
    lg: '0 12px 32px rgba(0, 0, 0, .12), 0 2px 8px rgba(0, 0, 0, .06)',
    xl: '0 12px 32px rgba(0, 0, 0, .12), 0 2px 8px rgba(0, 0, 0, .06)',
  },

  cursorType: 'pointer',
  focusRing: 'auto',
  respectReducedMotion: true,

  components: {
    ActionIcon: ActionIcon.extend({ classNames: { root: controls.tapTarget } }),
    Burger: Burger.extend({ classNames: { root: `${controls.tapTarget} ${controls.burger}` } }),
    Button: Button.extend({ classNames: { root: controls.tapTarget } }),
    CloseButton: CloseButton.extend({ classNames: { root: controls.tapTarget } }),
  },

  other: { layout, layoutBreakpoints, breakpointPx },
});
