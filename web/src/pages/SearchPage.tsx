import { Anchor, Group, Stack, Text } from '@mantine/core';
import { IconFileText } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link, useSearchParams } from 'react-router';

import { api } from '../api/client';
import type { SearchResponse } from '../api/types';
import { useApi } from '../api/useApi';
import { AsyncContent } from '../components/AsyncContent';
import { PageCard } from '../components/PageCard';
import rows from '../components/rows.module.css';
import { documentUrl } from '../paths';
import { PageContainer } from '../shell/PageContainer';
import { Snippet } from '../shell/Snippet';
import { SyncBadge } from '../shell/SyncBadge';

const nothing: SearchResponse = { hits: [], elapsed_ms: 0 };

export function Component(): JSX.Element {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const wanted = query.trim();

  const state = useApi<SearchResponse>(
    (signal) => (wanted === '' ? Promise.resolve(nothing) : api.search(wanted, undefined, { signal })),
    [wanted],
  );
  const found = wanted === '' ? undefined : state.data;

  return (
    <PageContainer>
      <PageCard
        data-testid="search"
        wide
        header={
          <>
            <Text data-testid="search-title" size="sm" fw={500} c="var(--scrawl-text)" truncate>
              {wanted === '' ? 'Search' : `Search: ${wanted}`}
            </Text>
            {found !== undefined && found.hits.length > 0 && (
              <Text
                data-testid="search-count"
                data-total={found.hits.length}
                size="sm"
                c="dimmed"
                style={{ flex: 'none' }}
              >
                {found.hits.length} {found.hits.length === 1 ? 'result' : 'results'} in {found.elapsed_ms} ms
              </Text>
            )}
          </>
        }
      >
        {wanted === '' ? (
          <Text data-testid="search-prompt" c="dimmed" className={rows.row}>
            Type a query to search every note.
          </Text>
        ) : (
          <AsyncContent state={state} testId="search">
            {(results) =>
              results.hits.length === 0 ? (
                <Text data-testid="search-empty" c="dimmed" className={rows.row}>
                  No notes match that.
                </Text>
              ) : (
                <div data-testid="search-results">
                  {results.hits.map((hit) => (
                    <div key={hit.path} data-testid="search-result" data-path={hit.path} className={rows.row}>
                      <IconFileText size={18} className={rows.icon} aria-hidden />
                      <Stack gap={2} className={rows.body}>
                        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                          <Anchor
                            data-testid="search-result-link"
                            component={Link}
                            // the query rides along so the reader lands with
                            // the matches highlighted
                            to={`${documentUrl(hit.path)}?q=${encodeURIComponent(wanted)}`}
                            c="var(--scrawl-text)"
                          >
                            {hit.title === '' ? hit.path : hit.title}
                          </Anchor>
                          <SyncBadge path={hit.path} />
                        </Group>
                        <Text
                          data-testid="search-result-path"
                          size="xs"
                          c="dimmed"
                          style={{ overflowWrap: 'anywhere' }}
                        >
                          {hit.path}
                        </Text>
                        <Snippet snippet={hit.snippet} testId="search-result-snippet" />
                      </Stack>
                    </div>
                  ))}
                </div>
              )
            }
          </AsyncContent>
        )}
      </PageCard>
    </PageContainer>
  );
}
