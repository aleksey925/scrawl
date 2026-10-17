import type { DiffRow } from '../api/types';

// how many unchanged blocks stay in sight around a change
export const diffContext = 1;

export interface DiffSegment {
  folded: boolean;
  rows: DiffRow[];
}

export function isChange(row: DiffRow): boolean {
  return row.kind !== 'same' && row.kind !== 'format';
}

// foldRows keeps every change and the context around it in sight, and puts each
// stretch of unchanged blocks between them under one fold
export function foldRows(rows: readonly DiffRow[], context: number = diffContext): DiffSegment[] {
  const shown = rows.map(() => false);
  rows.forEach((row, index) => {
    if (!isChange(row)) {
      return;
    }
    for (let k = Math.max(0, index - context); k <= Math.min(rows.length - 1, index + context); k++) {
      shown[k] = true;
    }
  });

  const res: DiffSegment[] = [];
  rows.forEach((row, index) => {
    const folded = !shown[index];
    const last = res[res.length - 1];
    if (last !== undefined && last.folded === folded) {
      last.rows.push(row);
    } else {
      res.push({ folded, rows: [row] });
    }
  });
  return res;
}
