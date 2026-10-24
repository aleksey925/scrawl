import { DEFAULT_THEME, defaultCssVariablesResolver, mergeMantineTheme } from '@mantine/core';

import { layoutVariables, themeOverride, themeVariables } from './theme';
import { autoTheme, blockNames, themeAttribute, themes, type Scheme, type ThemeDefinition } from './themes';

type Variables = Record<string, string>;

interface Scope {
  theme: ThemeDefinition;
  media?: string;
  selector: string;
}

// the scopes of theme.Scopes in go: every theme under its own attribute value,
// and the auto pair under a root with none, behind the system preference
function scopes(): Scope[] {
  const auto = (['light', 'dark'] as const satisfies readonly Scheme[]).map((scheme) => ({
    theme: autoTheme(scheme),
    media: `(prefers-color-scheme: ${scheme})`,
    selector: `:root:not([${themeAttribute}])`,
  }));
  return [...auto, ...themes.map((entry) => ({ theme: entry, selector: `:root[${themeAttribute}="${entry.id}"]` }))];
}

// a theme file is read without a schema, so one that left a token out would
// paint that part of the page in whatever theme came before it
function validate(): void {
  const keysOf = (tokens: object | undefined): string => Object.keys(tokens ?? {}).sort().join(' ');
  const light = autoTheme('light');
  for (const entry of themes) {
    for (const part of ['palette', 'blocks', 'shadows', 'code'] as const) {
      const got = keysOf(entry[part]);
      const want = keysOf(light[part]);
      if (got !== want) {
        throw new Error(`theme ${entry.id}: the ${part} has ${got}, the light theme ${want}`);
      }
    }
    if (keysOf(entry.blocks) !== [...blockNames].sort().join(' ')) {
      throw new Error(`theme ${entry.id}: the blocks are not ${blockNames.join(', ')}`);
    }
    for (const key of ['strongWeight', 'currentWeight'] as const) {
      if (typeof entry[key] !== 'string' || entry[key] === '') {
        throw new Error(`theme ${entry.id}: no ${key}`);
      }
    }
  }
}

interface Resolved {
  shared: Variables;
  scheme: Variables;
}

function resolve(entry: ThemeDefinition): Resolved {
  const base = defaultCssVariablesResolver(mergeMantineTheme(DEFAULT_THEME, themeOverride(entry)));
  return {
    shared: { ...base.variables, ...layoutVariables },
    scheme: { ...base[entry.scheme], ...themeVariables(entry) },
  };
}

function rule(selector: string, variables: Variables, scheme?: Scheme): string {
  const lines = Object.entries(variables).map(([name, value]) => `  ${name}: ${value};`);
  if (scheme !== undefined) {
    lines.push(`  color-scheme: ${scheme};`);
  }
  return `${selector} {\n${lines.join('\n')}\n}`;
}

// themeStylesheet is every custom property the app, the sign-in page and a page
// of the command line read, for every theme. What all themes share goes on
// :root once. A scheme variable never does: mantine's own sheet sets those
// under its attribute, which outranks a bare :root
export function themeStylesheet(): string {
  validate();
  const resolved = new Map(themes.map((entry) => [entry.id, resolve(entry)]));
  const all = [...resolved.values()];
  const first = all[0]?.shared ?? {};
  const root = Object.fromEntries(
    Object.entries(first).filter(([name, value]) => all.every((res) => res.shared[name] === value)),
  );

  const blocks = scopes().map(({ theme, media, selector }) => {
    const res = resolved.get(theme.id);
    if (res === undefined) {
      throw new Error(`theme ${theme.id} was not resolved`);
    }
    const own = Object.fromEntries(Object.entries(res.shared).filter(([name]) => !(name in root)));
    const block = rule(selector, { ...own, ...res.scheme }, theme.scheme);
    return media === undefined ? block : `@media ${media} {\n${block}\n}`;
  });
  return [rule(':root', root), ...blocks].join('\n\n');
}
