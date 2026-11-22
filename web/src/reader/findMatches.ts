import type { FindOptions } from './findOptions';

export interface FindQuery extends FindOptions {
  text: string;
}

export interface FindMatch {
  block: number;
  start: number;
  end: number;
}

export interface FindTerm {
  text: string;
  prefix: boolean;
}

export type FindPattern = { kind: 'regex'; source: string; flags: string } | { kind: 'words'; terms: FindTerm[] };

const maxMatches = 1000;
const oneTypoChars = 4;
const twoTypoChars = 8;
const firstAccented = 0xc0;
const lastAccented = 0x2fff;
const ownLetters = 'йЙїЇўЎ';
const finalSigma = 'ς';
const sigma = 'σ';
const accent = /^\p{Script=Inherited}$/u;
const accentMarks = '[^\\u0345\\P{Script=Inherited}]*';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const leadingFlags = /^\(\?([ims]+)\)/;

function fromRe2(pattern: string): { source: string; flags: string } {
  const lead = leadingFlags.exec(pattern);
  const flags = (lead?.[1] ?? '').replace('m', '');
  const rest = lead === null ? pattern : pattern.slice(lead[0].length);
  let source = '';
  for (let i = 0; i < rest.length; i++) {
    const next = rest[i + 1] ?? '';
    const after = rest[i + 2] ?? '';
    if (rest.startsWith('(?P<', i)) {
      source += '(?<';
      i += 3;
    } else if (rest[i] !== '\\') {
      source += rest[i];
    } else if (next === 'Q') {
      const end = rest.indexOf('\\E', i + 2);
      source += escapeRegExp(rest.slice(i + 2, end < 0 ? undefined : end));
      i = end < 0 ? rest.length : end + 1;
    } else if (next === 'A' || next === 'z') {
      source += next === 'A' ? '^' : '$';
      i++;
    } else if ((next === 'p' || next === 'P') && /^[A-Za-z]$/.test(after)) {
      source += `\\${next}{${after}}`;
      i += 2;
    } else {
      source += rest[i] + next;
      i++;
    }
  }
  return { source, flags };
}

interface AccentTable {
  base: Map<string, string>;
  variants: Map<string, string>;
}

let accentTable: AccentTable | undefined;

function accents(): AccentTable {
  if (accentTable !== undefined) {
    return accentTable;
  }
  const base = new Map<string, string>();
  const grouped = new Map<string, Set<string>>();
  for (let code = firstAccented; code <= lastAccented; code++) {
    const char = String.fromCodePoint(code);
    if (!/\p{L}/u.test(char) || ownLetters.includes(char)) {
      continue;
    }
    const [first = '', ...marks] = [...char.normalize('NFD')];
    if (marks.length === 0 || !marks.every((part) => accent.test(part))) {
      continue;
    }
    const lower = first.toLowerCase();
    base.set(char, lower);
    grouped.set(lower, (grouped.get(lower) ?? new Set([lower])).add(char));
  }
  const variants = new Map<string, string>();
  for (const [lower, set] of grouped) {
    variants.set(lower, [...set].join(''));
  }
  accentTable = { base, variants };
  return accentTable;
}

function fold(char: string): string {
  return accents().base.get(char) ?? (char === finalSigma ? sigma : char.toLowerCase());
}

function accentFree(text: string): string {
  let source = '';
  let afterLetter = false;
  for (const char of text) {
    if (afterLetter && accent.test(char)) {
      continue;
    }
    afterLetter = /\p{L}/u.test(char);
    if (!afterLetter) {
      source += escapeRegExp(char);
      continue;
    }
    const variants = accents().variants.get(fold(char));
    source += `${variants === undefined ? char : `[${variants}]`}${accentMarks}`;
  }
  return source;
}

const wordChars = /[\p{L}\p{N}\p{Mn}\u00ad\u200b-\u200d\ufeff]+/gu;
const ignorable = /[\p{Mn}\u00ad\u200b-\u200d\ufeff]/gu;

function termOf(word: string): string {
  return [...word.replace(ignorable, '')].map(fold).join('');
}

function termsOf(text: string): FindTerm[] {
  const typed = [...text.matchAll(wordChars)].map((found) => termOf(found[0])).filter((term) => term !== '');
  const last = /[\p{L}\p{N}]$/u.test(text.trim().replace(ignorable, '')) ? typed.at(-1) : undefined;
  return [...new Set(typed)].map((term) => ({ text: term, prefix: term === last }));
}

export function patternOf(query: FindQuery): FindPattern {
  const text = query.text.normalize('NFC');
  if (query.fuzzy) {
    return { kind: 'words', terms: termsOf(text) };
  }
  const typed = query.regex
    ? fromRe2(text)
    : { source: query.matchCase ? escapeRegExp(text) : accentFree(text), flags: '' };
  let source = typed.source;
  if (query.word) {
    source = `(?<![\\p{L}\\p{N}_]\\p{Mn}*)(?:${source})(?!\\p{Mn}*[\\p{L}\\p{N}_])`;
  }
  const flags = [...new Set(`gmu${query.matchCase ? '' : 'i'}${typed.flags}`)].join('');
  new RegExp(source, flags);
  return { kind: 'regex', source, flags };
}

function typosAllowed(term: string): number {
  const length = [...term].length;
  if (length < oneTypoChars) {
    return 0;
  }
  return length < twoTypoChars ? 1 : 2;
}

function withinTypos(term: string, word: string): boolean {
  const limit = typosAllowed(term);
  const a = [...term];
  const b = [...word];
  if (limit === 0 || term === word || Math.abs(a.length - b.length) > limit) {
    return false;
  }
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      let cost = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cost = Math.min(cost, (before[j - 2] ?? 0) + 1);
      }
      cur.push(cost);
    }
    if (Math.min(...cur) > limit) {
      return false;
    }
    before = prev;
    prev = cur;
  }
  return (prev[b.length] ?? 0) <= limit;
}

interface NfcText {
  text: string;
  starts: number[];
  ends: number[];
}

function startsPiece(piece: string, char: string): boolean {
  return !/\p{M}/u.test(char) && (piece + char).normalize('NFC') === piece.normalize('NFC') + char.normalize('NFC');
}

function nfcOf(text: string): NfcText {
  let nfc = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;
  const compose = (piece: string) => {
    const composed = piece.normalize('NFC');
    nfc += composed;
    for (let i = 0; i < composed.length; i++) {
      starts.push(at);
      ends.push(i === 0 ? at : at + piece.length);
    }
    at += piece.length;
  };
  let piece = '';
  for (const char of text) {
    if (piece !== '' && startsPiece(piece, char)) {
      compose(piece);
      piece = '';
    }
    piece += char;
  }
  compose(piece);
  starts.push(at);
  ends.push(at);
  return { text: nfc, starts, ends };
}

function regexMatches(texts: readonly string[], source: string, flags: string): FindMatch[] {
  const re = new RegExp(source, flags);
  const res: FindMatch[] = [];
  texts.forEach((text, block) => {
    re.lastIndex = 0;
    while (res.length < maxMatches) {
      const found = re.exec(text);
      if (found === null) {
        break;
      }
      if (found[0] === '') {
        const code = text.codePointAt(found.index);
        re.lastIndex = found.index + (code !== undefined && code > 0xffff ? 2 : 1);
        if (re.lastIndex > text.length) {
          break;
        }
        continue;
      }
      res.push({ block, start: found.index, end: found.index + found[0].length });
    }
  });
  return res;
}

function wordMatches(texts: readonly string[], terms: readonly FindTerm[]): FindMatch[] {
  const words = texts.flatMap((text, block) =>
    [...text.matchAll(wordChars)].map((found) => ({
      block,
      start: found.index,
      end: found.index + found[0].length,
      term: termOf(found[0]),
    })),
  );
  const wanted = new Set<number>();
  for (const sought of terms) {
    const exact = words.flatMap((entry, at) =>
      entry.term === sought.text || (sought.prefix && entry.term.startsWith(sought.text)) ? [at] : [],
    );
    const chosen = exact.length > 0 ? exact : words.flatMap((entry, at) => (withinTypos(sought.text, entry.term) ? [at] : []));
    for (const at of chosen) {
      wanted.add(at);
    }
  }
  return words
    .filter((_, at) => wanted.has(at))
    .slice(0, maxMatches)
    .map(({ block, start, end }) => ({ block, start, end }));
}

export function findMatches(texts: readonly string[], pattern: FindPattern): FindMatch[] {
  const nfcs = texts.map((original) => (original.normalize('NFC') === original ? null : nfcOf(original)));
  const joined = texts.map((original, block) => nfcs[block]?.text ?? original);
  const found = pattern.kind === 'regex' ? regexMatches(joined, pattern.source, pattern.flags) : wordMatches(joined, pattern.terms);
  const res: FindMatch[] = [];
  for (const raw of found) {
    const nfc = nfcs[raw.block] ?? null;
    const match = { block: raw.block, start: nfc?.starts[raw.start] ?? raw.start, end: nfc?.ends[raw.end] ?? raw.end };
    const last = res.at(-1);
    if (last !== undefined && last.block === match.block && match.start < last.end) {
      last.end = Math.max(last.end, match.end);
    } else if (match.start < match.end) {
      res.push(match);
    }
  }
  return res;
}

export class FindTimeout extends Error {
  constructor() {
    super('the pattern took too long');
    this.name = 'FindTimeout';
  }
}
