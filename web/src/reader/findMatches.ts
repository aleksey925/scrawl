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

export interface FindPattern {
  source: string;
  flags: string;
}

// maxMatches caps the marks one find puts into a note
export const maxMatches = 1000;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// patternOf is the one expression a query runs: unicode, line by line inside a
// block the way the search of the space runs each line, case-insensitive
// unless asked, and whole word by the letters, digits and _ around a match,
// which \b cannot say outside ASCII. It throws on a pattern the browser
// refuses.
export function patternOf(query: FindQuery): FindPattern {
  let source = query.regex ? query.text : escapeRegExp(query.text);
  if (query.word) {
    source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  }
  const flags = `gmu${query.matchCase ? '' : 'i'}`;
  // compiled here so a bad pattern is found before any work is handed out
  new RegExp(source, flags);
  return { source, flags };
}

// findMatches runs a pattern over the joined text of every block. An empty
// match is skipped: the scan moves on by one code point, so ^, $ and a* end
// instead of matching at one offset forever, and count nothing.
export function findMatches(texts: readonly string[], pattern: FindPattern, limit = maxMatches): FindMatch[] {
  const re = new RegExp(pattern.source, pattern.flags);
  const res: FindMatch[] = [];
  texts.forEach((text, block) => {
    re.lastIndex = 0;
    while (res.length < limit) {
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

// FindTimeout is a find that ran past its deadline and was stopped
export class FindTimeout extends Error {
  constructor() {
    super('the pattern took too long');
    this.name = 'FindTimeout';
  }
}
