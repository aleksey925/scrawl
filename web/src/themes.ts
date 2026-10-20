import type { MantineColorsTuple } from '@mantine/core';

// The color themes, one JSON file each in theme/themes/ at the root of the
// repository, where the go server reads them too. A palette is named by the
// role a color plays on Notion's page; each key becomes a --scrawl-* property
// that the note and the app's chrome both read
export interface Palette {
  bg: string;
  sidebar: string;
  sidebarEdge: string;
  sidebarText: string;
  text: string;
  // a note's text and its emphasis, which in the dark sit below and above
  // text, so bold differs in brightness and not only in weight
  textBody: string;
  textEmphasis: string;
  textSecondary: string;
  textTertiary: string;
  textFaint: string;
  icon: string;
  iconSecondary: string;
  iconTertiary: string;
  border: string;
  borderLight: string;
  borderTranslucent: string;
  hover: string;
  pressed: string;
  selected: string;
  rowHover: string;
  popover: string;
  overlay: string;
  codeBg: string;
  linkLine: string;
  placeholder: string;
  accent: string;
  accentStrong: string;
  accentTint: string;
  // the line round a field in focus, drawn inside its edge and once more just
  // outside it; a dark theme leaves the outer one clear and draws no color
  focusRing: string;
  focusRingOuter: string;
  onAccent: string;
  inlineCode: string;
  inlineCodeBg: string;
  toastBg: string;
  toastText: string;
  // the ground of a changed line, and of a changed word within it
  diffAddLine: string;
  diffAddWord: string;
  diffDeleteLine: string;
  diffDeleteWord: string;
}

export const blockNames = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;

export type BlockName = (typeof blockNames)[number];

export interface BlockColor {
  text: string;
  bg: string;
}

export type BlockColors = Record<BlockName, BlockColor>;

export interface Shadows {
  small: string;
  medium: string;
  large: string;
}

export type Scheme = 'light' | 'dark';

export type ThemeColorName = 'accent' | 'gray' | 'dark';

interface ThemeFile {
  name: string;
  scheme: Scheme;
  // the colors of code, which render builds a chroma style from; only the
  // go side reads them
  code: Record<'keyword' | 'string' | 'comment' | 'function' | 'number' | 'builtin', string>;
  strongWeight: string;
  palette: Palette;
  blocks: BlockColors;
  shadows: Shadows;
  // mantine's shade scales, where the theme replaces the ones in theme.ts
  colors?: Partial<Record<ThemeColorName, MantineColorsTuple>>;
}

export interface ThemeDefinition extends ThemeFile {
  id: string;
}

// the attribute naming the theme picked; absent, the system preference picks
// between the two auto themes
export const themeAttribute = 'data-scrawl-theme';

// the choice that follows the system preference
export const autoChoice = 'auto';

const files = import.meta.glob<ThemeFile>('../../theme/themes/*.json', { eager: true, import: 'default' });

function idOf(file: string): string {
  return file.replace(/^.*\//, '').replace(/\.json$/, '');
}

// the order of the go package: light themes first, the auto theme of each
// scheme ahead of the rest, the rest by name
function rank(entry: ThemeDefinition): number {
  return (entry.scheme === 'dark' ? 2 : 0) + (entry.id === entry.scheme ? 0 : 1);
}

export const themes: readonly ThemeDefinition[] = Object.entries(files)
  .map(([file, body]) => ({ ...body, id: idOf(file) }))
  .sort((a, b) => rank(a) - rank(b) || (a.name < b.name ? -1 : Number(a.name > b.name)));

export function lookupTheme(id: string): ThemeDefinition | undefined {
  return themes.find((entry) => entry.id === id);
}

export function autoTheme(scheme: Scheme): ThemeDefinition {
  const res = lookupTheme(scheme);
  if (res === undefined) {
    throw new Error(`no ${scheme} theme for auto to follow`);
  }
  return res;
}

export function isThemeChoice(value: string): boolean {
  return value === autoChoice || lookupTheme(value) !== undefined;
}

export function applyThemeAttribute(choice: string): void {
  if (lookupTheme(choice) === undefined) {
    document.documentElement.removeAttribute(themeAttribute);
  } else {
    document.documentElement.setAttribute(themeAttribute, choice);
  }
}

// tokenVariables spells a token object as custom properties: textSecondary
// under the prefix scrawl becomes --scrawl-text-secondary
export function tokenVariables(prefix: string, tokens: object): Record<string, string> {
  const res: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens)) {
    res[`--${prefix}-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`] = String(value);
  }
  return res;
}

// the attribute mantine keys its own rules on, set here before mantine is
// there to set it
export const colorSchemeAttribute = 'data-mantine-color-scheme';

// schemeOfChoice is the scheme a choice shows, auto's from the system
export function schemeOfChoice(choice: string): Scheme {
  return lookupTheme(choice)?.scheme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

// applyChoiceAttributes puts the page on a choice before the first paint
export function applyChoiceAttributes(choice: string): void {
  applyThemeAttribute(choice);
  document.documentElement.setAttribute(colorSchemeAttribute, schemeOfChoice(choice));
}
