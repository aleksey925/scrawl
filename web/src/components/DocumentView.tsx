import { Button, Group, Stack, Text, Title } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';

import { api } from '../api/client';
import { useApi } from '../api/useApi';
import { editUrl } from '../paths';

import { AsyncContent } from './AsyncContent';
import { DocumentBody } from './DocumentBody';

export interface DocumentViewProps {
  path: string;
}

export function DocumentView({ path }: DocumentViewProps): JSX.Element {
  const state = useApi((signal) => api.page(path, { signal }), [path]);

  return (
    <AsyncContent state={state} testId="doc">
      {(page) =>
        page.kind === 'missing-document' ? (
          <Stack data-testid="doc-missing" gap="lg">
            <Title data-testid="doc-title" order={1}>
              {page.title}
            </Title>
            <Text c="dimmed">This note does not exist yet.</Text>
            {page.can_create && (
              <Group>
                <Button
                  data-testid="doc-create"
                  component={Link}
                  to={editUrl(path)}
                  leftSection={<IconPlus size={16} />}
                >
                  Create it
                </Button>
              </Group>
            )}
          </Stack>
        ) : (
          <DocumentBody doc={page} />
        )
      }
    </AsyncContent>
  );
}
