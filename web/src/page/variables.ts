import { DEFAULT_THEME, defaultCssVariablesResolver, mergeMantineTheme } from '@mantine/core';

import { cssVariablesResolver, theme } from '../theme';

const schemeAttr = 'data-mantine-color-scheme';

function rule(selector: string, variables: Record<string, string>, scheme?: 'light' | 'dark'): string {
  const lines = Object.entries(variables).map(([name, value]) => `  ${name}: ${value};`);
  if (scheme !== undefined) {
    lines.push(`  color-scheme: ${scheme};`);
  }
  return `${selector} {\n${lines.join('\n')}\n}`;
}

// pageVariables is the stylesheet mantine writes at runtime in the app, written
// once at build time for a page that has no mantine: the same theme, under the
// same attribute, and the system's scheme while nothing was chosen
export function pageVariables(): string {
  const base = defaultCssVariablesResolver(mergeMantineTheme(DEFAULT_THEME, theme));
  const ours = cssVariablesResolver();
  const light = { ...base.light, ...ours.light };
  const dark = { ...base.dark, ...ours.dark };
  return [
    rule(':root', { ...base.variables, ...ours.variables }),
    `@media (prefers-color-scheme: light) {\n${rule(`:root:not([${schemeAttr}="dark"])`, light, 'light')}\n}`,
    `@media (prefers-color-scheme: dark) {\n${rule(`:root:not([${schemeAttr}="light"])`, dark, 'dark')}\n}`,
    rule(`:root[${schemeAttr}="light"]`, light, 'light'),
    rule(`:root[${schemeAttr}="dark"]`, dark, 'dark'),
  ].join('\n\n');
}
