import { useRef, type JSX } from 'react';

import type { DiffKind, DiffRow, DiffSide } from '../api/types';
import { countOf } from '../components/formats';
import { useKatex } from '../reader/useKatex';
import { useMermaid } from '../reader/useMermaid';

import { foldRows, isChange } from './fold';

import '../reader/markdown.css';
import './diff.css';

export type DiffLayout = 'split' | 'unified';

const tags: Record<DiffKind, string | undefined> = {
  same: undefined,
  format: 'Format',
  changed: 'Changed',
  added: 'Added',
  removed: 'Removed',
};

function shownOf(row: DiffRow): DiffSide[] {
  const sides =
    row.kind === 'removed'
      ? [row.old]
      : row.kind === 'changed'
        ? row.inline !== undefined
          ? [row.inline]
          : [row.old, row.new]
        : [row.new];
  return sides.filter((shown): shown is DiffSide => shown !== undefined);
}

function Html({ side, className }: { side: DiffSide; className: string }): JSX.Element {
  return <div className={`${className} markdown-document`} dangerouslySetInnerHTML={{ __html: side.html }} />;
}

function Cell({ side, which }: { side?: DiffSide; which: 'old' | 'new' }): JSX.Element {
  if (side === undefined) {
    return <div className={`diff-cell diff-${which} diff-empty`} />;
  }
  return <Html side={side} className={`diff-cell diff-${which}`} />;
}

function SplitRow({ row }: { row: DiffRow }): JSX.Element {
  return (
    <div className="diff-row" data-testid="diff-row" data-kind={row.kind}>
      <Cell side={row.old} which="old" />
      <Cell side={row.new} which="new" />
      {row.kind === 'format' && (
        <span className="diff-tag" title="Only the markup changed">
          {tags.format}
        </span>
      )}
    </div>
  );
}

function UnifiedRow({ row }: { row: DiffRow }): JSX.Element {
  const tag = tags[row.kind];
  return (
    <div className="diff-row" data-testid="diff-row" data-kind={row.kind}>
      {tag !== undefined && <span className="diff-tag">{tag}</span>}
      {shownOf(row).map((side, index) => (
        <Html key={index} side={side} className="diff-cell" />
      ))}
    </div>
  );
}

export interface RenderedDiffProps {
  rows: DiffRow[];
  layout: DiffLayout;
  oldLabel: string;
  newLabel: string;
  version: string;
}

export function RenderedDiff({ rows, layout, oldLabel, newLabel, version }: RenderedDiffProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const drawn = `${version}:${layout}`;
  useKatex(rootRef, drawn);
  useMermaid(rootRef, drawn);
  const Row = layout === 'split' ? SplitRow : UnifiedRow;

  return (
    <div ref={rootRef} className="diff" data-testid="rendered-diff" data-layout={layout}>
      {layout === 'split' ? (
        <div className="diff-head">
          <div>{oldLabel}</div>
          <div>{newLabel}</div>
        </div>
      ) : (
        <p className="diff-labels">
          {oldLabel} → {newLabel}
        </p>
      )}
      {!rows.some(isChange) && (
        <p className="diff-none" data-testid="rendered-diff-none">
          The text is the same, only the markup or the whitespace changed.
        </p>
      )}
      {foldRows(rows).map((segment, index) =>
        segment.folded ? (
          <details key={index} className="diff-fold" data-testid="diff-fold">
            <summary>{countOf(segment.rows.length, 'unchanged block')}</summary>
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
