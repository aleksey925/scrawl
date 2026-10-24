import {
  ActionIcon,
  Burger,
  Button,
  CloseButton,
  createTheme,
  Drawer,
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
import { tokenVariables, type BlockColors, type ThemeColorName, type ThemeDefinition } from './themes';

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
  // below it the app is a phone: a bar of tabs, a round Edit button, sheets
  phone: 'sm',
  sidebar: 'sm',
  miniOutline: 'sm',
  compactTopbar: 'sm',
  // the editor's splitter, or a tab per pane
  editorSplit: 'md',
} as const satisfies Record<string, BreakpointName>;

export const layout = {
  sidebarWidth: 240,
  noteWidth: 720,
  noteWidthWide: 960,
  pageMarginMin: 48,
  pageMarginMax: 96,
  topbarHeight: 45,
  topbarHeightCompact: 48,
  rowHeight: 30,
  iconSize: 20,
  iconSizeLarge: 22,
  iconSizeSmall: 16,
  iconSizeTool: 18,
  iconSizeColumn: 15,
  iconSizeTiny: 14,
  // a button and a field beside it, at their usual size, and a button that
  // runs the width of its column
  controlHeight: 28,
  controlHeightLarge: 36,
  tapTarget: 44,
  // on a touch screen: a button or a field, and a choice of a few, each one
  // height wherever it stands, so nothing beside it looks bigger or smaller
  touchControl: 40,
  touchChoice: 36,
  menuWidth: 220,
  menuWidthNarrow: 200,
  tabBarHeight: 56,
  editButtonSize: 54,
  inputFontSize: 16,
} as const;

// Notion's blue; the filled shade, 5, is the accent of the palette
const accentShades: MantineColorsTuple = [
  '#e5f2fc',
  '#cce4f8',
  '#9ccbf2',
  '#69b0ec',
  '#3f99e6',
  '#2383e2',
  '#1a74cc',
  '#105fad',
  '#0b4b8a',
  '#063766',
];

// Notion's warm grays in the order mantine reads them: gray from light to dark
// for the light scheme, dark from text to the deepest surface for the dark one
const grayShades: MantineColorsTuple = [
  '#f9f8f7',
  '#f7f6f3',
  '#f0efed',
  '#e6e5e3',
  '#d3d1cb',
  '#bcbab6',
  '#a19e99',
  '#7d7a75',
  '#5f5e5b',
  '#2c2c2b',
];

const darkShades: MantineColorsTuple = [
  '#f0efed',
  '#c9c6c0',
  '#ada9a3',
  '#7d7a75',
  '#5f5e59',
  '#383836',
  '#252525',
  '#202020',
  '#191919',
  '#141414',
];

const defaultColors: Record<ThemeColorName, MantineColorsTuple> = {
  accent: accentShades,
  gray: grayShades,
  dark: darkShades,
};

// Notion's own stacks
const sans =
  'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"';
const mono = '"SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';

function mantineVariables(def: ThemeDefinition): Record<string, string> {
  const { palette, blocks } = def;
  return {
    '--mantine-color-body': palette.bg,
    '--mantine-color-text': palette.text,
    '--mantine-color-dimmed': palette.textSecondary,
    '--mantine-color-error': blocks.red.text,
    '--mantine-color-anchor': palette.accent,
    '--mantine-color-default': palette.bg,
    '--mantine-color-default-color': palette.text,
    '--mantine-color-default-border': palette.border,
    '--mantine-color-default-hover': palette.hover,
    '--mantine-color-placeholder': palette.textTertiary,
    '--mantine-color-accent-filled': palette.accent,
    '--mantine-color-accent-filled-hover': palette.accentStrong,
    '--mantine-color-accent-light': palette.accentTint,
    '--mantine-color-accent-light-hover': palette.accentTint,
    '--mantine-color-accent-light-color': palette.accent,
    '--mantine-color-accent-outline': palette.accent,
    '--mantine-color-accent-outline-hover': palette.accentTint,
    '--mantine-color-red-filled': blocks.red.text,
    '--mantine-color-red-light': blocks.red.bg,
    '--mantine-color-red-light-color': blocks.red.text,
    '--mantine-color-red-text': blocks.red.text,
    '--mantine-color-orange-light': blocks.orange.bg,
    '--mantine-color-orange-light-color': blocks.orange.text,
  };
}

export const layoutVariables: Record<string, string> = {
  '--scrawl-sidebar-width': `${layout.sidebarWidth}px`,
  '--scrawl-note-width-normal': `${layout.noteWidth}px`,
  '--scrawl-note-width-wide': `${layout.noteWidthWide}px`,
  '--scrawl-page-margin-min': `${layout.pageMarginMin}px`,
  '--scrawl-page-margin-max': `${layout.pageMarginMax}px`,
  '--scrawl-topbar-height': `${layout.topbarHeight}px`,
  '--scrawl-row-height': `${layout.rowHeight}px`,
  '--scrawl-tap-target': `${layout.tapTarget}px`,
  '--scrawl-touch-control': `${layout.touchControl}px`,
  '--scrawl-touch-choice': `${layout.touchChoice}px`,
  '--scrawl-control-height': `${layout.controlHeight}px`,
  '--scrawl-control-height-large': `${layout.controlHeightLarge}px`,
  '--scrawl-input-font-size': `${layout.inputFontSize}px`,
  '--scrawl-menu-width': `${layout.menuWidth}px`,
  '--scrawl-tabbar-height': `${layout.tabBarHeight}px`,
  '--scrawl-edit-button': `${layout.editButtonSize}px`,
};

// blockVariables spells the block colors: blue's text is --scrawl-color-blue
// and its ground --scrawl-bg-blue
function blockVariables(blocks: BlockColors): Record<string, string> {
  const res: Record<string, string> = {};
  for (const [name, color] of Object.entries(blocks)) {
    res[`--scrawl-color-${name}`] = color.text;
    res[`--scrawl-bg-${name}`] = color.bg;
  }
  return res;
}

// themeVariables is what a theme sets on top of mantine's own variables
export function themeVariables(def: ThemeDefinition): Record<string, string> {
  return {
    ...tokenVariables('scrawl', def.palette),
    ...blockVariables(def.blocks),
    ...tokenVariables('scrawl-shadow', def.shadows),
    ...tokenVariables('scrawl-code', def.code),
    ...mantineVariables(def),
    '--scrawl-strong-weight': def.strongWeight,
    '--scrawl-current-weight': def.currentWeight,
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
      h1: { fontSize: '1.875rem', lineHeight: '1.3' },
      h2: { fontSize: '1.5rem', lineHeight: '1.3' },
      h3: { fontSize: '1.25rem', lineHeight: '1.3' },
      h4: { fontSize: '1rem', lineHeight: '1.3' },
      h5: { fontSize: '0.875rem', lineHeight: '1.3' },
      h6: { fontSize: '0.875rem', lineHeight: '1.3' },
    },
  },
  fontSizes: {
    xs: '0.75rem',
    sm: '0.875rem',
    md: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
  },
  // Notion sets a control in 500; mantine reads this one token and ships 600
  fontWeights: { medium: '500' },
  lineHeights: { xs: '1.2', sm: '1.3', md: '1.5', lg: '1.55', xl: '1.65' },

  // controls are md, menus lg and dialogs xl
  radius: { xs: '3px', sm: '4px', md: '6px', lg: '10px', xl: '12px' },
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
    xs: 'var(--scrawl-shadow-small)',
    sm: 'var(--scrawl-shadow-small)',
    md: 'var(--scrawl-shadow-medium)',
    lg: 'var(--scrawl-shadow-large)',
    xl: 'var(--scrawl-shadow-large)',
  },

  cursorType: 'pointer',
  focusRing: 'auto',
  respectReducedMotion: true,

  components: {
    ActionIcon: ActionIcon.extend({ classNames: { root: `${controls.tapTarget} ${controls.actionIcon}` } }),
    Burger: Burger.extend({ classNames: { root: `${controls.tapTarget} ${controls.burger}` } }),
    Button: Button.extend({ classNames: { root: controls.button } }),
    CloseButton: CloseButton.extend({ classNames: { root: controls.tapTarget } }),
    Input: Input.extend({ classNames: { wrapper: controls.input, input: controls.inputField } }),
    Menu: Menu.extend({
      defaultProps: { radius: 'lg', shadow: 'md' },
      classNames: { dropdown: controls.menu, item: controls.menuItem, label: controls.menuLabel },
    }),
    Modal: Modal.extend({
      defaultProps: { radius: 'xl', shadow: 'lg' },
      classNames: { overlay: controls.overlay, inner: controls.modalInner },
    }),
    Drawer: Drawer.extend({ classNames: { overlay: controls.overlay } }),
    SegmentedControl: SegmentedControl.extend({
      defaultProps: { withItemsBorders: false, radius: 'md' },
      classNames: { root: controls.segmentRoot, indicator: controls.segmentIndicator, label: controls.segment },
    }),
  },

  other: { layout, layoutBreakpoints, breakpointPx },
});

// themeOverride is the mantine theme with the shade scales a theme replaces
export function themeOverride(def: ThemeDefinition): MantineThemeOverride {
  return { ...theme, colors: { ...defaultColors, ...def.colors } };
}
