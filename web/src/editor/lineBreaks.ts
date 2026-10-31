export function lineBreakOf(text: string): string {
  return /\r\n?|\n/.exec(text)?.[0] ?? '\n';
}

export function toEditorText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export function withLineBreak(text: string, lineBreak: string): string {
  return lineBreak === '\n' ? text : text.replaceAll('\n', lineBreak);
}
