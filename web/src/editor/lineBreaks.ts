// codemirror splits on every kind of line break and joins its lines with \n,
// so the editor holds \n alone and a file gets its own break back on the way out

// lineBreakOf is the break a file's first line ends with, \n for one line
export function lineBreakOf(text: string): string {
  return /\r\n?|\n/.exec(text)?.[0] ?? '\n';
}

export function toEditorText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export function withLineBreak(text: string, lineBreak: string): string {
  return lineBreak === '\n' ? text : text.replaceAll('\n', lineBreak);
}
