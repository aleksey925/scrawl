export interface TocHeading {
  level: number;
  text: string;
  id: string;
}

export interface TocChange {
  from: number;
  to: number;
  insert: string;
}

const tocStart = '<!-- toc -->';
const tocEnd = '<!-- tocstop -->';

function markerLine(marker: string): RegExp {
  return new RegExp(`^[ \\t]*${marker}[ \\t]*$`, 'gm');
}

export function headingsOf(html: string): TocHeading[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll<HTMLHeadingElement>('h1[id], h2[id], h3[id], h4[id]'), (heading) => ({
    level: Number(heading.tagName.slice(1)),
    text: (heading.textContent ?? '').replace(/\s+/g, ' ').trim(),
    id: heading.id,
  }));
}

function label(text: string): string {
  return text.replace(/[\\[\]<>*_`]/g, (mark) => `\\${mark}`);
}

export function tocBlock(headings: readonly TocHeading[]): string | undefined {
  const listed = headings[0]?.level === 1 ? headings.slice(1) : headings;
  if (listed.length === 0) {
    return undefined;
  }
  const open: number[] = [];
  const lines = listed.map((heading) => {
    while (open.length > 0 && (open.at(-1) ?? 0) >= heading.level) {
      open.pop();
    }
    const depth = open.length;
    open.push(heading.level);
    return `${'  '.repeat(depth)}- [${label(heading.text)}](#${heading.id})`;
  });
  return `${tocStart}\n\n${lines.join('\n')}\n\n${tocEnd}`;
}

export function placeToc(doc: string, cursor: number, block: string): TocChange {
  const start = markerLine(tocStart);
  const startMatch = start.exec(doc);
  if (startMatch !== null) {
    const end = markerLine(tocEnd);
    end.lastIndex = start.lastIndex;
    const endMatch = end.exec(doc);
    if (endMatch !== null) {
      return { from: startMatch.index, to: end.lastIndex, insert: block };
    }
  }
  const lineEnd = doc.indexOf('\n', cursor);
  const at = lineEnd === -1 ? doc.length : lineEnd;
  const before = doc.slice(0, at);
  const after = doc.slice(at);
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = after === '' ? '\n' : after === '\n' || after.startsWith('\n\n') ? '' : '\n';
  return { from: at, to: at, insert: `${lead}${block}${trail}` };
}
