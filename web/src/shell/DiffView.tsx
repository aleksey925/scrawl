import { Box } from '@mantine/core';
import type { JSX } from 'react';

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
    return 'var(--scrawl-success)';
  }
  if (line.startsWith('-')) {
    return 'var(--scrawl-danger)';
  }
  return undefined;
}

export interface DiffViewProps {
  patch: string;
}

export function DiffView({ patch }: DiffViewProps): JSX.Element {
  return (
    <Box
      data-testid="history-diff"
      style={{
        minWidth: 0,
        maxHeight: 460,
        overflow: 'auto',
        border: '1px solid var(--scrawl-border)',
        borderRadius: 'var(--mantine-radius-md)',
        background: 'var(--scrawl-bg-inset)',
      }}
    >
      {/* the box is as wide as the longest line, so a coloured row keeps its
          colour all the way across when the patch is scrolled sideways */}
      <pre
        style={{
          margin: 0,
          padding: '8px 0',
          width: 'max-content',
          minWidth: '100%',
          fontFamily: 'var(--mantine-font-family-monospace)',
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {patch.split('\n').map((line, index) => (
          <span
            key={index}
            style={{ display: 'block', padding: '0 12px', whiteSpace: 'pre', color: lineColor(line) }}
          >
            {line === '' ? ' ' : line}
          </span>
        ))}
      </pre>
    </Box>
  );
}
