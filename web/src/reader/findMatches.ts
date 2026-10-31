export interface FindQuery {
  text: string;
  matchCase: boolean;
  word: boolean;
  regex: boolean;
}

export interface FindMatch {
  block: number;
  start: number;
  end: number;
}

export function togglesOf(params: URLSearchParams): Omit<FindQuery, 'text'> {
  return { matchCase: params.get('case') === '1', word: params.get('word') === '1', regex: params.get('regex') === '1' };
}

export interface FindPattern {
  source: string;
  flags: string;
}

const maxMatches = 1000;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const leadingFlags = /^\(\?([ims]+)\)/;

function fromRe2(pattern: string): FindPattern {
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

export function patternOf(query: FindQuery): FindPattern {
  const typed = query.regex ? fromRe2(query.text) : { source: escapeRegExp(query.text), flags: '' };
  let source = typed.source.normalize('NFC');
  if (query.word) {
    source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  }
  const flags = [...new Set(`gmu${query.matchCase ? '' : 'i'}${typed.flags}`)].join('');
  new RegExp(source, flags);
  return { source, flags };
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

export function findMatches(texts: readonly string[], pattern: FindPattern): FindMatch[] {
  const re = new RegExp(pattern.source, pattern.flags);
  const res: FindMatch[] = [];
  texts.forEach((original, block) => {
    const nfc = original.normalize('NFC') === original ? null : nfcOf(original);
    const joined = nfc?.text ?? original;
    re.lastIndex = 0;
    while (res.length < maxMatches) {
      const found = re.exec(joined);
      if (found === null) {
        break;
      }
      if (found[0] === '') {
        const code = joined.codePointAt(found.index);
        re.lastIndex = found.index + (code !== undefined && code > 0xffff ? 2 : 1);
        if (re.lastIndex > joined.length) {
          break;
        }
        continue;
      }
      const end = found.index + found[0].length;
      const match = { block, start: nfc?.starts[found.index] ?? found.index, end: nfc?.ends[end] ?? end };
      const last = res.at(-1);
      if (last !== undefined && last.block === block && match.start < last.end) {
        last.end = Math.max(last.end, match.end);
      } else if (match.start < match.end) {
        res.push(match);
      }
    }
  });
  return res;
}

export class FindTimeout extends Error {
  constructor() {
    super('the pattern took too long');
    this.name = 'FindTimeout';
  }
}
