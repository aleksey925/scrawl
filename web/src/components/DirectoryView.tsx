import { Anchor, Stack, Table, Text, Title } from '@mantine/core';
import { IconFile, IconFolder } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';

import { api } from '../api/client';
import { useApi } from '../api/useApi';

import { AsyncContent } from './AsyncContent';
import { DocumentHtml } from './DocumentHtml';

export interface DirectoryViewProps {
  path: string;
}

export function DirectoryView({ path }: DirectoryViewProps): JSX.Element {
  const state = useApi((signal) => api.dir(path, { signal }), [path]);

  return (
    <AsyncContent state={state}>
      {(dir) => (
        <Stack gap="xl">
          <Title order={1}>{dir.title}</Title>
          {dir.has_readme && <DocumentHtml html={dir.readme_html} />}
          {dir.entries.length === 0 ? (
            <Text c="dimmed">This folder is empty.</Text>
          ) : (
            <Table highlightOnHover>
              <Table.Tbody>
                {dir.entries.map((entry) => (
                  <Table.Tr key={entry.path}>
                    <Table.Td w={28}>
                      {entry.is_dir ? <IconFolder size={16} /> : <IconFile size={16} />}
                    </Table.Td>
                    <Table.Td>
                      <Anchor component={Link} to={entry.url}>
                        {entry.name}
                      </Anchor>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      )}
    </AsyncContent>
  );
}
