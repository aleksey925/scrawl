import { Anchor, Container, Stack, Text, Title } from '@mantine/core';
import type { JSX } from 'react';
import { Link, useSearchParams } from 'react-router';

import { api } from '../api/client';
import type { SearchResponse } from '../api/types';
import { useApi } from '../api/useApi';
import { AsyncContent } from '../components/AsyncContent';
import { documentUrl } from '../paths';
import { Snippet } from '../shell/Snippet';
import { layout } from '../theme';

const nothing: SearchResponse = { hits: [], elapsed_ms: 0 };

export function Component(): JSX.Element {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const wanted = query.trim();

  const state = useApi<SearchResponse>(
    (signal) => (wanted === '' ? Promise.resolve(nothing) : api.search(wanted, undefined, { signal })),
    [wanted],
  );

  return (
    <Container size={layout.contentMeasure} px={0} style={{ minWidth: 0 }}>
      <Stack gap="xl" style={{ minWidth: 0 }}>
        <Title order={1}>{wanted === '' ? 'Search' : `Search: ${wanted}`}</Title>

        {wanted === '' ? (
          <Text c="dimmed">Type a query to search every note.</Text>
        ) : (
          <AsyncContent state={state}>
            {(results) =>
              results.hits.length === 0 ? (
                <Text c="dimmed">No notes match that.</Text>
              ) : (
                <Stack gap="xl" style={{ minWidth: 0 }}>
                  <Text size="sm" c="dimmed">
                    {results.hits.length} {results.hits.length === 1 ? 'result' : 'results'} in{' '}
                    {results.elapsed_ms} ms
                  </Text>

                  {results.hits.map((hit) => (
                    <Stack key={hit.path} gap={4} style={{ minWidth: 0 }}>
                      <Anchor
                        component={Link}
                        // the query rides along so the reader lands with the
                        // matches highlighted
                        to={`${documentUrl(hit.path)}?q=${encodeURIComponent(wanted)}`}
                        fw={500}
                      >
                        {hit.title === '' ? hit.path : hit.title}
                      </Anchor>
                      <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                        {hit.path}
                      </Text>
                      <Snippet snippet={hit.snippet} />
                    </Stack>
                  ))}
                </Stack>
              )
            }
          </AsyncContent>
        )}
      </Stack>
    </Container>
  );
}
