import { Text } from '@mantine/core';
import { useState, type JSX } from 'react';
import { useSearchParams } from 'react-router';

import { api, searchTextOf, settingsOfSearch } from '../api/client';
import type { SearchResponse } from '../api/types';
import { useApi } from '../api/useApi';
import { AsyncContent } from '../components/AsyncContent';
import { countOf } from '../components/formats';
import { Page, PageTitle } from '../components/Page';
import { usePageChrome } from '../shell/PageChrome';
import { hintOf, SearchResults } from '../shell/SearchResults';

const nothing: SearchResponse = { hits: [], elapsed_ms: 0 };
const pageLimit = 50;
const noneExpanded: ReadonlySet<string> = new Set();

export function Component(): JSX.Element {
  const [searchParams] = useSearchParams();
  const settings = settingsOfSearch(searchParams);
  const wanted = searchTextOf(searchParams.get('q') ?? '', settings);
  const empty = wanted.trim() === '';
  const key = searchParams.toString();
  const [opened, setOpened] = useState<{ key: string; paths: ReadonlySet<string> }>({ key, paths: noneExpanded });
  const expanded = opened.key === key ? opened.paths : noneExpanded;
  usePageChrome({ crumbs: [], title: 'Search', ownTitle: true });

  const state = useApi<SearchResponse>(
    (signal) => (empty ? Promise.resolve(nothing) : api.find(wanted, settings, pageLimit, { signal })),
    [key],
  );
  const found = empty ? undefined : state.data;

  return (
    <Page data-testid="search">
      <PageTitle testId="search-title">{empty ? 'Search' : `Search: ${wanted}`}</PageTitle>
      {found !== undefined && found.hits.length > 0 && (
        <Text data-testid="search-count" data-total={found.hits.length} size="sm" c="dimmed" mb="md">
          {countOf(found.hits.length, 'result')} in {found.elapsed_ms} ms ·{' '}
          {hintOf(settings)}
          {found.truncated === true ? ', stopped early' : ''}
        </Text>
      )}
      {empty ? (
        <Text data-testid="search-prompt" c="dimmed">
          Type a query to search every note.
        </Text>
      ) : (
        <AsyncContent state={state} testId="search">
          {(results) =>
            results.hits.length === 0 ? (
              <Text data-testid="search-empty" c="dimmed">
                No notes match that.
              </Text>
            ) : (
              <SearchResults
                hits={results.hits}
                expanded={expanded}
                onExpand={(path) => setOpened({ key, paths: new Set(expanded).add(path) })}
              />
            )
          }
        </AsyncContent>
      )}
    </Page>
  );
}
