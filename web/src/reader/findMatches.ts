// FindQuery is what the find bar of a note looks for
export interface FindQuery {
  text: string;
  matchCase: boolean;
  word: boolean;
  regex: boolean;
}

// FindMatch is one match, in the joined text of one block
export interface FindMatch {
  block: number;
  start: number;
  end: number;
}

// togglesOf reads the toggles a search address carries, which a search and the
// find bar of the note it opens both take
export function togglesOf(params: URLSearchParams): Omit<FindQuery, 'text'> {
  return { matchCase: params.get('case') === '1', word: params.get('word') === '1', regex: params.get('regex') === '1' };
}

export interface FindPattern {
  source: string;
  flags: string;
}

// maxMatches caps the marks one find puts into a note
const maxMatches = 1000;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// leadingFlags is an RE2 flag group opening a pattern, which javascript takes
// as flags of the whole expression; m is how a find runs anyway
const leadingFlags = /^\(\?([ims]+)\)/;

// fromRe2 spells what the search of the space took as RE2 the way javascript
// does: \A and \z are the ends of the line the search scans, \Q...\E is a
// literal, (?P<name> a named group and \pL a class
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

// patternOf is the one expression a query runs: unicode, line by line inside a
// block the way the search of the space runs each line, case-insensitive
// unless asked, and whole word by the letters, digits and _ around a match,
// which \b cannot say outside ASCII. It throws on a pattern the browser
// refuses.
export function patternOf(query: FindQuery): FindPattern {
  const typed = query.regex ? fromRe2(query.text) : { source: escapeRegExp(query.text), flags: '' };
  let source = typed.source.normalize('NFC');
  if (query.word) {
    source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  }
  const flags = [...new Set(`gmu${query.matchCase ? '' : 'i'}${typed.flags}`)].join('');
  // compiled here so a bad pattern is found before any work is handed out
  new RegExp(source, flags);
  return { source, flags };
}

// NfcText is a text in NFC, the form the search of the space matches, with
// the offset in the text each of its offsets starts and ends a match at
interface NfcText {
  text: string;
  starts: number[];
  ends: number[];
}

// startsPiece says whether NFC leaves the piece before a character apart from
// it. A mark may reorder with or compose into the piece; a Hangul vowel after
// its consonant is a letter and still composes with it.
function startsPiece(piece: string, char: string): boolean {
  return !/\p{M}/u.test(char) && (piece + char).normalize('NFC') === piece.normalize('NFC') + char.normalize('NFC');
}

// nfcOf composes a text a piece at a time, each piece what NFC turns into one
// whole, so an offset inside a composed letter maps to the whole of it
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

// findMatches runs a pattern over the joined text of every block, read in NFC
// the way the index reads a note. An empty match is skipped: the scan moves on
// by one code point, so ^, $ and a* end instead of matching at one offset
// forever, and count nothing.
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
      // two matches inside one composed piece map to the whole of it each
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

// FindTimeout is a find that ran past its deadline and was stopped
export class FindTimeout extends Error {
  constructor() {
    super('the pattern took too long');
    this.name = 'FindTimeout';
  }
}
