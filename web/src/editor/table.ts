import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState, type Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { clamp } from './anchor';
import { parseBudgetMs } from './constants';

export type TableEdit =
  | 'rowAbove'
  | 'rowBelow'
  | 'columnLeft'
  | 'columnRight'
  | 'deleteRow'
  | 'deleteColumn'
  | 'deleteTable';

type Align = 'none' | 'left' | 'center' | 'right';

interface Table {
  header: string[];
  aligns: Align[];
  body: string[][];
}

export interface TableSize {
  columns: number;
  rows: number;
}

interface CellAt {
  row: number;
  column: number;
}

interface TableSpot extends CellAt {
  from: number;
  to: number;
  prefixes: string[];
  table: Table;
}

interface Rendered {
  text: string;
  cursor: number;
}

const minCellWidth = 3;
const delimiterLine = 1;

function splitRow(text: string): string[] {
  const trimmed = text.trim();
  const inner = trimmed.slice(trimmed.startsWith('|') ? 1 : 0, trimmed.length > 1 && trimmed.endsWith('|') ? -1 : undefined);
  const cells = [''];
  let escaped = false;
  for (const char of inner) {
    if (char === '|' && !escaped) {
      cells.push('');
    } else {
      cells[cells.length - 1] += char;
    }
    escaped = char === '\\';
  }
  return cells.map((entry) => entry.trim());
}

function columnAt(text: string, offset: number): number {
  let pipes = 0;
  let escaped = false;
  for (const char of text.slice(0, offset)) {
    if (char === '|' && !escaped) {
      pipes += 1;
    }
    escaped = char === '\\';
  }
  return text.trimStart().startsWith('|') ? pipes - 1 : pipes;
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) {
    return 'center';
  }
  return left ? 'left' : right ? 'right' : 'none';
}

function padded<T>(cells: readonly T[], width: number, fill: T): T[] {
  return Array.from({ length: width }, (_, index) => cells[index] ?? fill);
}

function emptyRow(width: number): string[] {
  return padded([], width, '');
}

function blankLine(doc: Text, number: number): boolean {
  return number < 1 || number > doc.lines || doc.line(number).text.trim() === '';
}

function tableRowStarts(state: EditorState, pos: number): number[] | undefined {
  const line = state.doc.lineAt(pos);
  const tree = ensureSyntaxTree(state, state.doc.length, parseBudgetMs) ?? syntaxTree(state);
  let starts: number[] | undefined;
  tree.iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (starts !== undefined) {
        return false;
      }
      if (node.name !== 'Table') {
        return undefined;
      }
      starts = [];
      for (let child = node.node.firstChild; child !== null; child = child.nextSibling) {
        if (child.name === 'TableHeader' || child.name === 'TableDelimiter' || child.name === 'TableRow') {
          starts.push(child.from);
        }
      }
      return false;
    },
  });
  return starts;
}

function tableSpot(state: EditorState, pos: number): TableSpot | undefined {
  const starts = tableRowStarts(state, pos);
  if (starts === undefined || starts.length <= delimiterLine) {
    return undefined;
  }
  const rowLines = starts.map((from) => state.doc.lineAt(from));
  const cursorLine = state.doc.lineAt(pos);
  const lineIndex = rowLines.findIndex((line) => line.number === cursorLine.number);
  const first = rowLines[0];
  const last = rowLines.at(-1);
  if (lineIndex < 0 || first === undefined || last === undefined) {
    return undefined;
  }

  const prefixes = rowLines.map((line, index) => line.text.slice(0, (starts[index] ?? line.from) - line.from));
  const texts = rowLines.map((line, index) => line.text.slice(prefixes[index]?.length ?? 0));
  const [headerText = '', delimiterText = '', ...bodyTexts] = texts;
  const header = splitRow(headerText);
  const body = bodyTexts.map(splitRow);
  const width = Math.max(header.length, ...body.map((cells) => cells.length));
  const offset = Math.max(pos - cursorLine.from - (prefixes[lineIndex]?.length ?? 0), 0);
  const column = columnAt(texts[lineIndex] ?? '', offset);

  return {
    from: first.from,
    to: last.to,
    prefixes,
    table: {
      header: padded(header, width, ''),
      aligns: padded(splitRow(delimiterText).map(alignOf), width, 'none'),
      body: body.map((cells) => padded(cells, width, '')),
    },
    row: lineIndex <= delimiterLine ? 0 : lineIndex - delimiterLine,
    column: clamp(column, 0, width - 1),
  };
}

function textWidth(text: string): number {
  return [...text].length;
}

function fitted(cell: string, width: number, align: Align): string {
  const gap = width - textWidth(cell);
  if (align === 'right') {
    return ' '.repeat(gap) + cell;
  }
  if (align === 'center') {
    const before = Math.floor(gap / 2);
    return ' '.repeat(before) + cell + ' '.repeat(gap - before);
  }
  return cell + ' '.repeat(gap);
}

function delimiterCell(width: number, align: Align): string {
  switch (align) {
    case 'left':
      return `:${'-'.repeat(width - 1)}`;
    case 'right':
      return `${'-'.repeat(width - 1)}:`;
    case 'center':
      return `:${'-'.repeat(width - 2)}:`;
    case 'none':
      return '-'.repeat(width);
  }
}

function lineOfRow(row: number): number {
  return row === 0 ? 0 : row + delimiterLine;
}

function renderTable(table: Table, prefixes: readonly string[], at: CellAt): Rendered {
  const widths = table.aligns.map((_, column) =>
    Math.max(minCellWidth, ...[table.header, ...table.body].map((cells) => textWidth(cells[column] ?? ''))),
  );
  const fittedRow = (cells: readonly string[]): string[] =>
    cells.map((value, column) => fitted(value, widths[column] ?? minCellWidth, table.aligns[column] ?? 'none'));
  const rows = [
    fittedRow(table.header),
    table.aligns.map((align, column) => delimiterCell(widths[column] ?? minCellWidth, align)),
    ...table.body.map(fittedRow),
  ];
  const prefixOf = (index: number): string => prefixes[index] ?? '';
  const lines = rows.map((cells, index) => `${prefixOf(index)}| ${cells.join(' | ')} |`);

  const lineIndex = lineOfRow(at.row);
  const lineStart = lines.slice(0, lineIndex).reduce((sum, text) => sum + text.length + 1, 0);
  const cellStart = (rows[lineIndex] ?? []).slice(0, at.column).reduce((sum, cell) => sum + cell.length + 3, 2);
  return { text: lines.join('\n'), cursor: lineStart + prefixOf(lineIndex).length + cellStart };
}

function insertedAt<T>(cells: readonly T[], index: number, value: T): T[] {
  return [...cells.slice(0, index), value, ...cells.slice(index)];
}

function removedAt<T>(cells: readonly T[], index: number): T[] {
  return cells.filter((_, at) => at !== index);
}

interface Edited {
  table: Table;
  prefixes: string[];
  at: CellAt;
}

function edited(spot: TableSpot, edit: Exclude<TableEdit, 'deleteTable'>): Edited {
  const { table, prefixes, row, column } = spot;
  switch (edit) {
    case 'rowAbove':
    case 'rowBelow': {
      const bodyIndex = edit === 'rowAbove' ? row - 1 : row;
      const prefix = prefixes[Math.max(lineOfRow(row), delimiterLine)] ?? '';
      return {
        table: { ...table, body: insertedAt(table.body, bodyIndex, emptyRow(table.aligns.length)) },
        prefixes: insertedAt(prefixes, lineOfRow(bodyIndex + 1), prefix),
        at: { row: bodyIndex + 1, column },
      };
    }
    case 'columnLeft':
    case 'columnRight': {
      const index = edit === 'columnLeft' ? column : column + 1;
      return {
        table: {
          header: insertedAt(table.header, index, ''),
          aligns: insertedAt<Align>(table.aligns, index, 'none'),
          body: table.body.map((cells) => insertedAt(cells, index, '')),
        },
        prefixes,
        at: { row, column: index },
      };
    }
    case 'deleteRow': {
      const body = removedAt(table.body, row - 1);
      return {
        table: { ...table, body },
        prefixes: removedAt(prefixes, lineOfRow(row)),
        at: { row: Math.min(row, body.length), column },
      };
    }
    case 'deleteColumn':
      return {
        table: {
          header: removedAt(table.header, column),
          aligns: removedAt(table.aligns, column),
          body: table.body.map((cells) => removedAt(cells, column)),
        },
        prefixes,
        at: { row, column: Math.min(column, table.aligns.length - 2) },
      };
  }
}

function editsOf(spot: TableSpot): ReadonlySet<TableEdit> {
  const edits = new Set<TableEdit>(['rowBelow', 'columnLeft', 'columnRight', 'deleteTable']);
  if (spot.row > 0) {
    edits.add('rowAbove');
    edits.add('deleteRow');
  }
  if (spot.table.aligns.length > 1) {
    edits.add('deleteColumn');
  }
  return edits;
}

export function tableEditsAtCursor(state: EditorState): ReadonlySet<TableEdit> | undefined {
  const spot = tableSpot(state, state.selection.main.head);
  return spot === undefined ? undefined : editsOf(spot);
}

function deleteTable(view: EditorView, spot: TableSpot): void {
  const { doc } = view.state;
  const first = doc.lineAt(spot.from).number;
  const end = doc.lineAt(spot.to).number;
  const last = end < doc.lines && blankLine(doc, end + 1) && blankLine(doc, first - 1) ? end + 1 : end;
  const to = last < doc.lines ? doc.line(last + 1).from : doc.length;
  const from = last < doc.lines || first === 1 ? doc.line(first).from : doc.line(first - 1).to;
  view.dispatch({
    changes: { from, to },
    selection: EditorSelection.cursor(from),
    scrollIntoView: true,
  });
}

export function runTableEdit(view: EditorView, edit: TableEdit): void {
  const spot = tableSpot(view.state, view.state.selection.main.head);
  if (spot !== undefined && editsOf(spot).has(edit)) {
    if (edit === 'deleteTable') {
      deleteTable(view, spot);
    } else {
      const next = edited(spot, edit);
      const { text, cursor } = renderTable(next.table, next.prefixes, next.at);
      view.dispatch({
        changes: { from: spot.from, to: spot.to, insert: text },
        selection: EditorSelection.cursor(spot.from + cursor),
        scrollIntoView: true,
      });
    }
  }
  view.focus();
}

export function insertTable(view: EditorView, { columns, rows }: TableSize): void {
  const { state } = view;
  const { doc } = state;
  const line = doc.lineAt(state.selection.main.head);
  const { text, cursor } = renderTable(
    {
      header: emptyRow(columns),
      aligns: padded<Align>([], columns, 'none'),
      body: Array.from({ length: rows - 1 }, () => emptyRow(columns)),
    },
    [],
    { row: 0, column: 0 },
  );

  const onBlank = line.text.trim() === '';
  const from = onBlank ? line.from : line.to;
  const before = onBlank ? (blankLine(doc, line.number - 1) ? '' : '\n') : '\n\n';
  const after = blankLine(doc, line.number + 1) ? '' : '\n';
  view.dispatch({
    changes: { from, to: line.to, insert: before + text + after },
    selection: EditorSelection.cursor(from + before.length + cursor),
    scrollIntoView: true,
  });
  view.focus();
}
