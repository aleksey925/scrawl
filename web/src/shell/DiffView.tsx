import type { JSX } from 'react';

import classes from './DiffView.module.css';

const metaPrefixes = [
  'diff --git', 'index ', 'new file', 'deleted file', 'old mode', 'new mode',
  'similarity ', 'rename ', 'copy ', '--- ', '+++ ', 'Binary files',
];

function lineColor(line: string): string | undefined {
  if (metaPrefixes.some((prefix) => line.startsWith(prefix))) {
    return 'var(--scrawl-text-tertiary)';
  }
  if (line.startsWith('@@')) {
    return 'var(--scrawl-accent)';
  }
  if (line.startsWith('+')) {
    return 'var(--scrawl-color-green)';
  }
  if (line.startsWith('-')) {
    return 'var(--scrawl-color-red)';
  }
  return undefined;
}

export interface DiffViewProps {
  patch: string;
}

export function DiffView({ patch }: DiffViewProps): JSX.Element {
  return (
    <div data-testid="history-diff" className={classes.box}>
      <pre className={classes.patch}>
        {patch.split('\n').map((line, index) => (
          <span key={index} className={classes.line} style={{ color: lineColor(line) }}>
            {line === '' ? ' ' : line}
          </span>
        ))}
      </pre>
    </div>
  );
}
