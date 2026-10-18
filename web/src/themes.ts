import type { MantineColorsTuple } from '@mantine/core';

// The color themes, one JSON file each in theme/themes/ at the root of the
// repository, where the go server reads them too. A palette is named the way
// GitHub's Primer names its tokens; a note reaches it as --gh-*, the way
// github-markdown-css names it, and the app's chrome through --scrawl-*
export interface Palette {
  fgDefault: string;
  // not Primer tokens: a note's text and its emphasis, which in the dark sit
  // below and above fgDefault, so bold differs in brightness and not only weight
  fgBody: string;
  fgEmphasis: string;
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
  // not Primer tokens: a <mark> is a highlighter, opaque yellow under dark text
  // in both schemes, because a translucent yellow over the dark ground is brown
  bgMark: string;
  fgMark: string;
  bgAccentMuted: string;
  bgAccentEmphasis: string;
  // not a Primer token: the next step of its blue scale, for a filled hover
  bgAccentEmphasisHover: string;
  bgDangerMuted: string;
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
  // Primer's diffBlob tokens: the ground of a changed line, and of a changed
  // word within it
  diffAdditionLine: string;
  diffAdditionWord: string;
  diffDeletionLine: string;
  diffDeletionWord: string;
}

export type Scheme = 'light' | 'dark';

export type ThemeColorName = 'accent' | 'gray' | 'dark';

interface ThemeFile {
  name: string;
  scheme: Scheme;
  // the chroma style of code; only the go side reads it
  code: string;
  strongWeight: string;
  palette: Palette;
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

// tokenVariables spells a token object as custom properties: fgDefault under
// the prefix gh becomes --gh-fg-default
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

// applyChoiceAttributes puts the page on a choice before the first paint
export function applyChoiceAttributes(choice: string): void {
  applyThemeAttribute(choice);
  const scheme = lookupTheme(choice)?.scheme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute(colorSchemeAttribute, scheme);
}
