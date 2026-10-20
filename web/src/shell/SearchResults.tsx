import { IconFileText } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';

import type { SearchHit, SearchSpan } from '../api/types';
import { layout } from '../theme';

import classes from './Search.module.css';
import { SyncBadge } from './SyncBadge';

// linesShown is how many matching lines a note shows before "N more lines"
const linesShown = 3;

// SearchTarget is one row a search can open: a note's head, or one of its lines
export interface SearchTarget {
  key: string;
  url: string;
}

// targetsOf is every row of the results in the order they are on screen,
// which is what the arrows walk
export function targetsOf(hits: readonly SearchHit[], expanded: ReadonlySet<string>): SearchTarget[] {
  return hits.flatMap((hit) => [
    { key: hit.path, url: hit.url },
    ...(hit.lines ?? [])
      .slice(0, expanded.has(hit.path) ? undefined : linesShown)
      .map((line) => ({ key: `${hit.path}:${line.line}`, url: line.url })),
  ]);
}

function Spans({ spans }: { spans: readonly SearchSpan[] }): JSX.Element {
  return (
    <>
      {spans.map((span, index) =>
        span.hit ? (
          <mark key={index} className={classes.hit}>
            {span.text}
          </mark>
        ) : (
          <span key={index}>{span.text}</span>
        ),
      )}
    </>
  );
}

export interface SearchResultsProps {
  hits: readonly SearchHit[];
  // active is the key of the row the arrows are on
  active?: string;
  // expanded are the notes showing every line the answer carried
  expanded: ReadonlySet<string>;
  onExpand: (path: string) => void;
  // onOpen is called as a row is followed, before the router moves
  onOpen?: () => void;
}

// SearchResults is the notes a search found, each with its matching lines: the
// line number and the line as a reader sees it, the matches marked. The urls
// are the server's, and the client only follows them.
export function SearchResults({ hits, active, expanded, onExpand, onOpen }: SearchResultsProps): JSX.Element {

  return (
    <div data-testid="search-results">
      {hits.map((hit) => {
        const lines = hit.lines ?? [];
        const shown = expanded.has(hit.path) ? lines : lines.slice(0, linesShown);
        const rest = lines.length - shown.length;
        return (
          <div key={hit.path} className={classes.file}>
            <Link
              data-testid="search-result"
              data-path={hit.path}
              data-active={active === hit.path ? 'true' : 'false'}
              to={hit.url}
              className={classes.head}
              onClick={onOpen}
            >
              <IconFileText size={layout.iconSizeSmall} />
              <span data-testid="search-result-title" className={classes.title}>
                {hit.title_spans === undefined || hit.title_spans.length === 0 ? (
                  hit.title === '' ? hit.path : hit.title
                ) : (
                  <Spans spans={hit.title_spans} />
                )}
              </span>
              <span className={classes.path}>{hit.path}</span>
              <SyncBadge path={hit.path} />
              {hit.match_count !== undefined && hit.match_count > 0 && (
                <span className={classes.count}>
                  {hit.match_count} {hit.match_count === 1 ? 'match' : 'matches'}
                </span>
              )}
            </Link>
            {shown.map((line) => {
              const key = `${hit.path}:${line.line}`;
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
            {rest > 0 && (
              <button
                type="button"
                data-testid="search-more"
                className={classes.more}
                onClick={() => onExpand(hit.path)}
              >
                {rest} more {rest === 1 ? 'line' : 'lines'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
