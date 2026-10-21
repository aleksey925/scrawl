import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

interface Alias {
  name: string;
  of: string;
  extensions?: string[];
  filename?: RegExp;
}

// the names codemirror's set does not know, or knows as a rarer language, each
// put on the closest language it holds
const aliases: Alias[] = [
  // before the config files below, which would take its extension
  { name: 'Nginx', of: 'Nginx', filename: /^nginx.*\.conf$/i },
  { name: 'Config', of: 'Properties files', extensions: ['conf', 'cfg', 'env', 'editorconfig'] },
  { name: 'Objective-C', of: 'Objective-C', extensions: ['m'] },
  { name: 'Svelte', of: 'HTML', extensions: ['svelte'] },
  { name: 'Astro', of: 'HTML', extensions: ['astro'] },
  { name: 'Elixir', of: 'Ruby', extensions: ['ex', 'exs'] },
  { name: 'Ruby', of: 'Ruby', filename: /^(Vagrantfile|Brewfile|Podfile|Fastfile)$/ },
  { name: 'JSON with comments', of: 'JavaScript', extensions: ['jsonc', 'json5'] },
  { name: 'JSON lines', of: 'JavaScript', extensions: ['jsonl', 'ndjson'] },
  { name: 'JSON', of: 'JSON', extensions: ['ipynb', 'webmanifest'] },
  { name: 'Shell', of: 'Shell', extensions: ['zsh', 'fish', 'ksh'] },
  { name: 'Makefile', of: 'Shell', extensions: ['mk'], filename: /^(GNUmakefile|[Mm]akefile)$/ },
  { name: 'Justfile', of: 'Shell', filename: /^[Jj]ustfile$/ },
  { name: 'TOML', of: 'TOML', filename: /^(Cargo|poetry|uv)\.lock$|^Pipfile$/ },
  { name: 'Twig', of: 'Jinja', extensions: ['twig', 'njk'] },
  { name: 'Racket', of: 'Scheme', extensions: ['rkt'] },
  { name: 'Assembly', of: 'Gas', extensions: ['asm'] },
  { name: 'XML', of: 'XML', extensions: ['plist', 'xsd'] },
  { name: 'Scala', of: 'Scala', extensions: ['sbt'] },
  { name: 'Python', of: 'Python', extensions: ['pyi'] },
];

const aliased: LanguageDescription[] = aliases.flatMap(({ name, of, extensions, filename }) => {
  const target = languages.find((known) => known.name === of);
  return target === undefined ? [] : [LanguageDescription.of({ name, extensions, filename, load: () => target.load() })];
});

// codeLanguageOf is the language a text file's name says it is written in, if
// the editor can color it
export function codeLanguageOf(name: string): LanguageDescription | null {
  return LanguageDescription.matchFilename(aliased, name) ?? LanguageDescription.matchFilename(languages, name);
}
