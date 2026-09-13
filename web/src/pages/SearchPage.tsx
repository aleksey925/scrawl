import { Anchor, Container, Stack, Text, Title } from '@mantine/core';
import type { JSX } from 'react';
import { Link, useSearchParams } from 'react-router';

import { api } from '../api/client';
import { useApi } from '../api/useApi';
import { AsyncContent } from '../components/AsyncContent';
import { documentUrl } from '../paths';
import { layout } from '../theme';

export function Component(): JSX.Element {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const state = useApi((signal) => api.search(query, undefined, { signal }), [query]);

  return (
    <Container size={layout.contentMeasure} px={0}>
      <Stack gap="xl">
        <Title order={1}>{query === '' ? 'Search' : `Search: ${query}`}</Title>
        <AsyncContent state={state}>
          {(results) =>
            results.hits.length === 0 ? (
              <Text c="dimmed">No notes match that.</Text>
            ) : (
              <Stack gap="lg">
                {results.hits.map((hit) => (
                  <Stack key={hit.path} gap={4}>
                    <Anchor component={Link} to={documentUrl(hit.path)} fw={500}>
                      {hit.title === '' ? hit.path : hit.title}
                    </Anchor>
                    <Text size="xs" c="dimmed">
                      {hit.path}
                    </Text>
                  </Stack>
                ))}
              </Stack>
            )
          }
        </AsyncContent>
      </Stack>
    </Container>
  );
}
