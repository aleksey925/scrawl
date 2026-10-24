import type { MantineColorsTuple } from '@mantine/core';
import type { CSSProperties } from 'react';

export interface Palette {
  bg: string;
  sidebar: string;
  sidebarEdge: string;
  sidebarText: string;
  sidebarIcon: string;
  text: string;
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
  menu: string;
  menuHighlight: string;
  menuHighlightText: string;
  menuHighlightMuted: string;
  overlay: string;
  codeBg: string;
  link: string;
  linkLine: string;
  placeholder: string;
  accent: string;
  accentStrong: string;
  accentTint: string;
  focusRing: string;
  focusRingOuter: string;
  onAccent: string;
  inlineCode: string;
  inlineCodeBg: string;
  toastBg: string;
  toastText: string;
  diffAddLine: string;
  diffAddWord: string;
  diffDeleteLine: string;
  diffDeleteWord: string;
}

export const fontSmoothings = ['auto', 'antialiased'] as const;

export type FontSmoothing = (typeof fontSmoothings)[number];

export const blockNames = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;

export type BlockName = (typeof blockNames)[number];

export function blockColorOf(name: string): BlockName {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return blockNames[hash % blockNames.length] ?? 'gray';
}

export function blockStyle(name: BlockName): CSSProperties {
  return { background: `var(--scrawl-bg-${name})`, color: `var(--scrawl-color-${name})` };
}

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
  code: Record<'keyword' | 'string' | 'comment' | 'function' | 'number' | 'builtin', string>;
  strongWeight: string;
  currentWeight: string;
  fontSmoothing: FontSmoothing;
  palette: Palette;
  blocks: BlockColors;
  shadows: Shadows;
  colors?: Partial<Record<ThemeColorName, MantineColorsTuple>>;
}

export interface ThemeDefinition extends ThemeFile {
  id: string;
}

export const themeAttribute = 'data-scrawl-theme';

export const autoChoice = 'auto';

const files = import.meta.glob<ThemeFile>('../../theme/themes/*.json', { eager: true, import: 'default' });

function idOf(file: string): string {
  return file.replace(/^.*\//, '').replace(/\.json$/, '');
}

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

export function tokenVariables(prefix: string, tokens: object): Record<string, string> {
  const res: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens)) {
    res[`--${prefix}-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`] = String(value);
  }
  return res;
}

export const colorSchemeAttribute = 'data-mantine-color-scheme';

export function schemeOfChoice(choice: string): Scheme {
  return lookupTheme(choice)?.scheme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

export function applyChoiceAttributes(choice: string): void {
  applyThemeAttribute(choice);
  document.documentElement.setAttribute(colorSchemeAttribute, schemeOfChoice(choice));
}
