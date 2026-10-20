import { useRef, type JSX } from 'react';

import type { DiffKind, DiffRow, DiffSide } from '../api/types';
import { useKatex } from '../reader/useKatex';
import { useMermaid } from '../reader/useMermaid';

import { foldRows, isChange } from './fold';

import '../reader/markdown.css';
import './diff.css';

// the word beside a block that says what happened to it; page/page.go writes
// the same words in tagOf
const tags: Record<DiffKind, string | undefined> = {
  same: undefined,
  format: 'Format',
  changed: 'Changed',
  added: 'Added',
  removed: 'Removed',
};

// shownOf is what a row shows in the one column: a removed block as it was, a
// changed one with its lost and new words in one block, or both sides when that
// could not be built, and anything else as it is now. page/page.go: shownOf.
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

function Row({ row }: { row: DiffRow }): JSX.Element {
  const tag = tags[row.kind];
  return (
    <div className="diff-row" data-testid="diff-row" data-kind={row.kind}>
      {tag !== undefined && <span className="diff-tag">{tag}</span>}
      {shownOf(row).map((side, index) => (
        // what arrives here was rendered and sanitized on the server by the
        // policy in render/policy.go, and htmldiff only added its own marks
        <div key={index} className="diff-cell markdown-document" dangerouslySetInnerHTML={{ __html: side.html }} />
      ))}
    </div>
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export interface RenderedDiffProps {
  rows: DiffRow[];
  // names what is compared, so formulas and diagrams are typeset again when it
  // changes and not on every render
  version: string;
}

// RenderedDiff shows what changed in a note as a reader sees it: the note in
// one column, each block that changed tagged with what happened to it and its
// words marked, unchanged stretches folded away
export function RenderedDiff({ rows, version }: RenderedDiffProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  useKatex(rootRef, version);
  useMermaid(rootRef, version);

  return (
    <div ref={rootRef} className="diff" data-testid="rendered-diff">
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
