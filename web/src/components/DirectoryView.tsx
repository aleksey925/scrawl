import { Anchor, Stack, Table, Text, Title } from '@mantine/core';
import { IconFile, IconFolder } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';

import { api } from '../api/client';
import { useApi } from '../api/useApi';

import { AsyncContent } from './AsyncContent';
import { DocumentBody } from './DocumentBody';
import { DocumentHtml } from './DocumentHtml';

export interface DirectoryViewProps {
  path: string;
}

export function DirectoryView({ path }: DirectoryViewProps): JSX.Element {
  const state = useApi((signal) => api.dir(path, { signal }), [path]);

  return (
    <AsyncContent state={state} testId="dir">
      {(dir) =>
        dir.kind === 'document' ? (
          <DocumentBody doc={dir} />
        ) : (
          <Stack data-testid="dir" gap="xl">
            <Title data-testid="dir-title" order={1}>
              {dir.title}
            </Title>
            {dir.has_readme && <DocumentHtml html={dir.readme_html} />}
            {dir.entries.length === 0 ? (
              <Text data-testid="dir-empty" c="dimmed">
                This folder is empty.
              </Text>
            ) : (
              <Table data-testid="dir-table" highlightOnHover>
                <Table.Tbody>
                  {dir.entries.map((entry) => (
                    <Table.Tr
                      key={entry.path}
                      data-testid="dir-row"
                      data-path={entry.path}
                      data-dir={entry.is_dir ? 'true' : 'false'}
                    >
                      <Table.Td w={28}>
                        {entry.is_dir ? <IconFolder size={16} /> : <IconFile size={16} />}
                      </Table.Td>
                      <Table.Td>
                        <Anchor data-testid="dir-row-name" component={Link} to={entry.url}>
                          {entry.name}
                        </Anchor>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Stack>
        )
      }
    </AsyncContent>
  );
}
