import { useRef, type JSX } from 'react';

import type { DiffKind, DiffRow, DiffSide } from '../api/types';
import { useKatex } from '../reader/useKatex';
import { useMermaid } from '../reader/useMermaid';

import { foldRows, isChange } from './fold';

import '../reader/markdown.css';
import './diff.css';

// DiffLayout is how the rows are laid out: the two versions side by side, or
// the note once with the changes marked in it. page.Layout names the same two.
export type DiffLayout = 'split' | 'unified';

// the word beside a block that says what happened to it; page/page.go writes
// the same words in tagOf
const tags: Record<DiffKind, string | undefined> = {
  same: undefined,
  format: 'Format',
  changed: 'Changed',
  added: 'Added',
  removed: 'Removed',
};

// shownOf is what a row shows in the unified layout: a removed block as it was,
// a changed one with its lost and new words in one block, or both sides when
// that could not be built, and anything else as it is now. page/page.go: shownOf.
function shownOf(row: DiffRow): DiffSide[] {
  const sides =
    row.kind === 'removed'
      ? [row.old]
      : row.kind === 'changed'
        ? row.inline !== undefined
          ? [row.inline]
          : [row.old, row.new]
        : [row.new];
  return sides.filter((side): side is DiffSide => side !== undefined);
}

// Html is a side as the server sent it: rendered and sanitized by the policy in
// render/policy.go, and htmldiff only added its own marks to it
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

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export interface RenderedDiffProps {
  rows: DiffRow[];
  layout: DiffLayout;
  oldLabel: string;
  newLabel: string;
  // names what is compared, so formulas and diagrams are typeset again when it
  // changes and not on every render
  version: string;
}

// RenderedDiff shows what changed in a note as a reader sees it, changed words
// marked and unchanged stretches folded away
export function RenderedDiff({ rows, layout, oldLabel, newLabel, version }: RenderedDiffProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  useKatex(rootRef, version);
  useMermaid(rootRef, version);
  const Row = layout === 'split' ? SplitRow : UnifiedRow;

  return (
    <div ref={rootRef} className="diff" data-testid="rendered-diff" data-layout={layout}>
      {layout === 'split' && (
        <div className="diff-head">
          <div>{oldLabel}</div>
          <div>{newLabel}</div>
        </div>
      )}
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
