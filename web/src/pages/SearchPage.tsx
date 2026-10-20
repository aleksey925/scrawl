import { Text } from '@mantine/core';
import { useState, type JSX } from 'react';
import { useSearchParams } from 'react-router';

import { api } from '../api/client';
import type { SearchResponse, SearchSettings } from '../api/types';
import { useApi } from '../api/useApi';
import { AsyncContent } from '../components/AsyncContent';
import { Page, PageTitle } from '../components/Page';
import { usePageChrome } from '../shell/PageChrome';
import { hintOf } from '../shell/SearchDialog';
import { SearchResults } from '../shell/SearchResults';

const nothing: SearchResponse = { hits: [], elapsed_ms: 0 };
const pageLimit = 50;

// settingsOf reads the mode and the toggles the way the search route does
function settingsOf(params: URLSearchParams): SearchSettings {
  return {
    mode: params.get('mode') === 'exact' ? 'exact' : 'fuzzy',
    matchCase: params.get('case') === '1',
    word: params.get('word') === '1',
    regex: params.get('regex') === '1',
    titles: params.get('titles') === '1',
  };
}

// the search page is a typed or shared address of a search, drawn with the
// results the dialog shows
export function Component(): JSX.Element {
  const [searchParams] = useSearchParams();
  const wanted = (searchParams.get('q') ?? '').trim();
  const settings = settingsOf(searchParams);
  const key = searchParams.toString();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  usePageChrome({ crumbs: [], title: 'Search', ownTitle: true });

  const state = useApi<SearchResponse>(
    (signal) => (wanted === '' ? Promise.resolve(nothing) : api.find(wanted, settings, pageLimit, { signal })),
    [key],
  );
  const found = wanted === '' ? undefined : state.data;

  return (
    <Page data-testid="search">
      <PageTitle testId="search-title">{wanted === '' ? 'Search' : `Search: ${wanted}`}</PageTitle>
      {found !== undefined && found.hits.length > 0 && (
        <Text data-testid="search-count" data-total={found.hits.length} size="sm" c="dimmed" mb="md">
          {found.hits.length} {found.hits.length === 1 ? 'result' : 'results'} in {found.elapsed_ms} ms ·{' '}
          {hintOf(settings)}
          {found.truncated === true ? ', stopped early' : ''}
        </Text>
      )}
      {wanted === '' ? (
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
                onExpand={(path) => setExpanded((prev) => new Set(prev).add(path))}
              />
            )
          }
        </AsyncContent>
      )}
    </Page>
  );
}
