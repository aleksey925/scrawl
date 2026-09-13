import { createTheme, type MantineColorsTuple, type MantineThemeOverride } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';

import breakpointValues from './breakpoints.json';

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
} as const satisfies Record<string, BreakpointName>;

export const layout = {
  sidebarWidth: 264,
  tocWidth: 240,
  contentMeasure: 740,
  topbarHeight: 52,
  topbarHeightCompact: 48,
  tapTarget: 44,
  // an input below 16px makes iOS zoom the page on focus and never zoom back
  inputFontSize: 16,
} as const;

export interface ScrawlTokens {
  bg: string;
  bgSubtle: string;
  bgInset: string;
  bgRaised: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentHover: string;
  accentActive: string;
  accentSubtle: string;
  accentBorder: string;
  danger: string;
  success: string;
  warning: string;
}

export const lightTokens: ScrawlTokens = {
  bg: '#ffffff',
  bgSubtle: '#f7f7f5',
  bgInset: '#f5f5f4',
  bgRaised: '#ffffff',
  // the greys are tuned for AA contrast on their own surfaces, not picked
  text: '#1d1d1f',
  textSecondary: '#55555c',
  textTertiary: '#70707a',
  border: '#e6e6e3',
  borderStrong: '#d2d2cf',
  accent: '#0071e3',
  accentHover: '#0062c4',
  accentActive: '#0055ab',
  accentSubtle: '#eaf3fd',
  accentBorder: '#b9dbfa',
  danger: '#c9252d',
  success: '#1c7a3e',
  warning: '#9a6400',
};

export const darkTokens: ScrawlTokens = {
  bg: '#1c1c1e',
  bgSubtle: '#161618',
  bgInset: '#242426',
  bgRaised: '#2c2c2e',
  text: '#f5f5f7',
  textSecondary: '#a1a1a6',
  textTertiary: '#8e8e95',
  border: '#323235',
  borderStrong: '#48484b',
  accent: '#0a84ff',
  accentHover: '#3d9bff',
  accentActive: '#63aeff',
  accentSubtle: '#16273c',
  accentBorder: '#1f4b7a',
  danger: '#ff6961',
  success: '#30d158',
  warning: '#ffb340',
};

const accentShades: MantineColorsTuple = [
  '#eaf3fd',
  '#d5e7fb',
  '#b9dbfa',
  '#8ec4f7',
  '#5aa8f2',
  '#2a8bea',
  '#0071e3',
  '#0062c4',
  '#0055ab',
  '#00448a',
];

const sans =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif';
const mono =
  'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, "Cascadia Mono", "Roboto Mono", "DejaVu Sans Mono", Consolas, "Liberation Mono", monospace';

function tokenVariables(tokens: ScrawlTokens): Record<string, string> {
  const res: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens)) {
    res[`--scrawl-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`] = value;
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
    '--mantine-color-default': tokens.bgRaised,
    '--mantine-color-default-color': tokens.text,
    '--mantine-color-default-border': tokens.border,
    '--mantine-color-default-hover': tokens.bgInset,
    '--mantine-color-accent-filled': tokens.accent,
    '--mantine-color-accent-filled-hover': tokens.accentHover,
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
    light: { ...tokenVariables(lightTokens), ...mantineVariables(lightTokens) },
    dark: { ...tokenVariables(darkTokens), ...mantineVariables(darkTokens) },
  };
}

export const theme: MantineThemeOverride = createTheme({
  primaryColor: 'accent',
  primaryShade: { light: 6, dark: 6 },
  colors: { accent: accentShades },

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

  other: { layout, layoutBreakpoints, breakpointPx },
});
