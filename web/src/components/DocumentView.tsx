import { Button, Group, Stack, Text, Title } from '@mantine/core';
import { IconHistory, IconPencil, IconPlus } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';

import { api } from '../api/client';
import { useApi } from '../api/useApi';
import { editUrl, historyUrl } from '../paths';
import { PageActions, PageToc } from '../shell/ShellSlots';
import { TocList } from '../shell/TocList';

import { AsyncContent } from './AsyncContent';
import { DocumentHtml } from './DocumentHtml';

export interface DocumentViewProps {
  path: string;
}

export function DocumentView({ path }: DocumentViewProps): JSX.Element {
  const state = useApi((signal) => api.page(path, { signal }), [path]);

  return (
    <AsyncContent state={state}>
      {(page) =>
        page.kind === 'missing-document' ? (
          <Stack gap="lg">
            <Title order={1}>{page.title}</Title>
            <Text c="dimmed">This note does not exist yet.</Text>
            {page.can_create && (
              <Group>
                <Button
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
          <>
            <PageActions>
              <Button
                component={Link}
                to={page.edit_url}
                variant="default"
                size="xs"
                leftSection={<IconPencil size={16} />}
              >
                Edit
              </Button>
              <Button
                component={Link}
                to={historyUrl(path)}
                variant="subtle"
                color="gray"
                size="xs"
                leftSection={<IconHistory size={16} />}
              >
                History
              </Button>
            </PageActions>

            {page.show_toc && page.toc.length > 0 && (
              <PageToc>
                <TocList headings={page.toc} />
              </PageToc>
            )}

            <DocumentHtml html={page.html} />
          </>
        )
      }
    </AsyncContent>
  );
}
