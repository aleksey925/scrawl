import type { JSX } from 'react';
import { Link } from 'react-router';

import type { SearchHit, SearchSettings, SearchSpan } from '../api/types';
import { IconFileText } from '../icons';
import { layout } from '../theme';

import classes from './Search.module.css';
import { SyncBadge } from './SyncBadge';

export function hintOf(settings: SearchSettings): string {
  if (settings.regex) {
    return 'Regular expression over the text as shown, line by line';
  }
  return settings.mode === 'exact' ? 'The text exactly as typed' : 'Words in any order, one typo per word is fine';
}

const linesShown = 3;

export interface SearchTarget {
  key: string;
  url: string;
}

export function targetsOf(hits: readonly SearchHit[], expanded: ReadonlySet<string>): SearchTarget[] {
  return hits.flatMap((row) => [
    { key: row.path, url: row.url },
    ...(row.lines ?? [])
      .slice(0, expanded.has(row.path) ? undefined : linesShown)
      .map((match) => ({ key: `${row.path}:${match.line}`, url: match.url })),
  ]);
}

function Spans({ spans }: { spans: readonly SearchSpan[] }): JSX.Element {
  return (
    <>
      {spans.map((part, index) =>
        part.hit ? (
          <mark key={index} className={classes.hit}>
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

export interface SearchResultsProps {
  hits: readonly SearchHit[];
  active?: string;
  expanded: ReadonlySet<string>;
  onExpand: (path: string) => void;
  onOpen?: () => void;
}

export function SearchResults({ hits, active, expanded, onExpand, onOpen }: SearchResultsProps): JSX.Element {
  return (
    <div data-testid="search-results">
      {hits.map((row) => {
        const lines = row.lines ?? [];
        const shown = expanded.has(row.path) ? lines : lines.slice(0, linesShown);
        const rest = Math.max(row.line_count ?? 0, lines.length) - shown.length;
        const restLabel = `${rest} more ${rest === 1 ? 'line' : 'lines'}`;
        return (
          <div key={row.path} className={classes.file}>
            <Link
              data-testid="search-result"
              data-path={row.path}
              data-active={active === row.path ? 'true' : 'false'}
              to={row.url}
              className={classes.head}
              onClick={onOpen}
            >
              <IconFileText size={layout.iconSizeSmall} />
              <span data-testid="search-result-title" className={classes.title}>
                {row.title_spans === undefined || row.title_spans.length === 0 ? (
                  row.title === '' ? row.path : row.title
                ) : (
                  <Spans spans={row.title_spans} />
                )}
              </span>
              <span className={classes.path}>{row.path}</span>
              <SyncBadge path={row.path} />
              {row.match_count !== undefined && row.match_count > 0 && (
                <span className={classes.count}>
                  {row.match_count} {row.match_count === 1 ? 'match' : 'matches'}
                </span>
              )}
            </Link>
            {shown.map((line) => {
              const key = `${row.path}:${line.line}`;
              return (
                <Link
                  key={key}
                  data-testid="search-line"
                  data-line={line.line}
                  data-active={active === key ? 'true' : 'false'}
                  to={line.url}
                  className={classes.line}
                  onClick={onOpen}
                >
                  <span className={classes.number}>{line.line}</span>
                  <span className={classes.text}>
                    <Spans spans={line.spans} />
                  </span>
                </Link>
              );
            })}
            {rest > 0 &&
              (shown.length < lines.length ? (
                <button type="button" data-testid="search-more" className={classes.more} onClick={() => onExpand(row.path)}>
                  {restLabel}
                </button>
              ) : (
                <Link data-testid="search-more" to={row.url} className={classes.more} onClick={onOpen}>
                  {restLabel} in the note
                </Link>
              ))}
          </div>
        );
      })}
    </div>
  );
}
