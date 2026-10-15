import { useRef, type JSX } from 'react';

import type { DiffRow, DiffSide } from '../api/types';
import { useKatex } from '../reader/useKatex';
import { useMermaid } from '../reader/useMermaid';

import { foldRows, isChange } from './fold';

import '../reader/markdown.css';
import './diff.css';

function Cell({ side, which }: { side?: DiffSide; which: 'old' | 'new' }): JSX.Element {
  if (side === undefined) {
    return <div className={`diff-cell diff-${which} diff-empty`} />;
  }
  // what arrives here was rendered and sanitized on the server by the policy in
  // render/policy.go, and htmldiff only added its own del and ins marks to it
  return (
    <div
      className={`diff-cell diff-${which} markdown-document`}
      dangerouslySetInnerHTML={{ __html: side.html }}
    />
  );
}

function Row({ row }: { row: DiffRow }): JSX.Element {
  return (
    <div className="diff-row" data-testid="diff-row" data-kind={row.kind}>
      <Cell side={row.old} which="old" />
      <Cell side={row.new} which="new" />
      {row.kind === 'format' && (
        <span className="diff-badge" title="Only the markup changed">
          format
        </span>
      )}
    </div>
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export interface RenderedDiffProps {
  rows: DiffRow[];
  oldLabel: string;
  newLabel: string;
  // names what is compared, so formulas and diagrams are typeset again when it
  // changes and not on every render
  version: string;
}

// RenderedDiff shows two versions of a note as a reader sees them: block beside
// block, changed words marked, unchanged stretches folded away
export function RenderedDiff({ rows, oldLabel, newLabel, version }: RenderedDiffProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  useKatex(rootRef, version);
  useMermaid(rootRef, version);

  return (
    <div ref={rootRef} className="diff" data-testid="rendered-diff">
      <div className="diff-head">
        <div>{oldLabel}</div>
        <div>{newLabel}</div>
      </div>
      {!rows.some(isChange) && (
        <p className="diff-none" data-testid="rendered-diff-none">
          The text is the same, only the markup or the whitespace changed.
        </p>
      )}
      {foldRows(rows).map((segment, index) =>
        segment.folded ? (
          <details key={index} className="diff-fold" data-testid="diff-fold">
            <summary>{plural(segment.rows.length, 'unchanged block')}</summary>
            {segment.rows.map((row, at) => (
              <Row key={at} row={row} />
            ))}
          </details>
        ) : (
          segment.rows.map((row, at) => <Row key={`${index}-${at}`} row={row} />)
        ),
      )}
    </div>
  );
}
