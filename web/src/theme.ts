import {
  ActionIcon,
  Burger,
  Button,
  CloseButton,
  createTheme,
  Input,
  Menu,
  Modal,
  SegmentedControl,
  type MantineColorsTuple,
  type MantineThemeOverride,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';

import breakpointValues from './breakpoints.json';
import controls from './controls.module.css';
import { tokenVariables, type Palette, type ThemeColorName, type ThemeDefinition } from './themes';

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
  tocWidth: 256,
  // the gap between a rail card and the edge of the screen or the page
  railGutter: 8,
  contentMeasure: 740,
  // the room a note card keeps around the text, on a desktop and on a phone
  notePadding: 32,
  topbarHeight: 60,
  topbarHeightCompact: 48,
  // the head of a card, which holds the path and the note's actions
  cardHeadHeight: 46,
  topbarIconSize: 18,
  // a button and a field beside it, at their usual size
  controlHeight: 36,
  controlHeightSmall: 30,
  tapTarget: 44,
  // the switcher names the space and then gets out of the way of the page
  // actions, which are what a phone topbar must never push off the row
  spaceSwitcherWidth: 280,
  spaceSwitcherWidthCompact: 130,
  inputFontSize: 16,
} as const;

// iconEdgeInset is the padding that puts the glyph of an icon button, not its
// 44px box, on the phone's 16px edge, where the text of the page starts
export function iconEdgeInset(glyphSize: number): string {
  return `calc(var(--mantine-spacing-lg) - (var(--scrawl-tap-target) - ${glyphSize}px) / 2)`;
}

export interface ScrawlTokens {
  bg: string;
  ground: string;
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
    ground: palette.bgInset,
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
  '#d1d7e0',
  '#b7bdc8',
  '#9198a1',
  '#656c76',
  '#3d444d',
  '#262c36',
  '#212830',
  '#1a2129',
  '#121821',
  '#0d1117',
];

const defaultColors: Record<ThemeColorName, MantineColorsTuple> = {
  accent: accentShades,
  gray: grayShades,
  dark: darkShades,
};

// GitHub's own stacks. github.com names "Mona Sans VF" first but ships no face
// for it, so what a reader sees there is the system font that follows
const sans =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"';
const mono = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

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

export const layoutVariables: Record<string, string> = {
  '--scrawl-sidebar-width': `${layout.sidebarWidth}px`,
  '--scrawl-toc-width': `${layout.tocWidth}px`,
  '--scrawl-rail-gutter': `${layout.railGutter}px`,
  '--scrawl-content-measure': `${layout.contentMeasure}px`,
  '--scrawl-note-padding': `${layout.notePadding}px`,
  '--scrawl-topbar-height': `${layout.topbarHeight}px`,
  '--scrawl-card-head': `${layout.cardHeadHeight}px`,
  '--scrawl-tap-target': `${layout.tapTarget}px`,
  '--scrawl-control-height': `${layout.controlHeight}px`,
  '--scrawl-control-height-small': `${layout.controlHeightSmall}px`,
  '--scrawl-input-font-size': `${layout.inputFontSize}px`,
};

// themeVariables is what a theme sets on top of mantine's own variables
export function themeVariables(def: ThemeDefinition): Record<string, string> {
  const tokens = scrawlTokens(def.palette);
  return {
    ...tokenVariables('scrawl', tokens),
    ...tokenVariables('gh', def.palette),
    ...mantineVariables(tokens),
    '--scrawl-strong-weight': def.strongWeight,
  };
}

export const theme: MantineThemeOverride = createTheme({
  primaryColor: 'accent',
  primaryShade: { light: 5, dark: 5 },
  colors: defaultColors,

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
  // Primer sets a control in 500; mantine reads this one token and ships 600
  fontWeights: { medium: '500' },
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
    Button: Button.extend({ classNames: { root: `${controls.tapTarget} ${controls.button}` } }),
    CloseButton: CloseButton.extend({ classNames: { root: controls.tapTarget } }),
    Input: Input.extend({ classNames: { wrapper: controls.input, input: controls.inputField } }),
    // a surface floating over the page takes the radius of a card
    Menu: Menu.extend({
      defaultProps: { radius: 'lg' },
      classNames: { dropdown: controls.menu, item: controls.menuItem, label: controls.menuLabel },
    }),
    Modal: Modal.extend({ defaultProps: { radius: 'lg' } }),
    SegmentedControl: SegmentedControl.extend({ classNames: { label: controls.segment } }),
  },

  other: { layout, layoutBreakpoints, breakpointPx },
});

// themeOverride is the mantine theme with the shade scales a theme replaces
export function themeOverride(def: ThemeDefinition): MantineThemeOverride {
  return { ...theme, colors: { ...defaultColors, ...def.colors } };
}
