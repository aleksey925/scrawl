import { Button, Group, Stack, Text, Title } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';

import { answerKeys, useApi } from '../api/useApi';
import { editUrl } from '../paths';
import { usePlatform } from '../platform';
import { PageCrumbs } from '../shell/PathCrumbs';
import { SyncBadge } from '../shell/SyncBadge';

import { AsyncContent } from './AsyncContent';
import { DocumentBody } from './DocumentBody';

export interface DocumentViewProps {
  path: string;
}

export function DocumentView({ path }: DocumentViewProps): JSX.Element {
  const { source } = usePlatform();
  const state = useApi((signal) => source.page(path, { signal }), [source, path], answerKeys.page(path));

  return (
    <AsyncContent state={state} testId="doc">
      {(page) =>
        page.kind === 'missing-document' ? (
          <Stack data-testid="doc-missing" gap="lg">
            <PageCrumbs />
            <Group gap="xs" wrap="nowrap">
              <Title data-testid="doc-title" order={1}>
                {page.title}
              </Title>
              {/* a deletion that failed to push leaves the note gone here and
                  present on the remote, and this is the screen that says so */}
              <SyncBadge path={path} />
            </Group>
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
