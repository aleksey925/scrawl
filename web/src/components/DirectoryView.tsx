import { Anchor, Button, Stack, Table, Title } from '@mantine/core';
import { IconFile, IconFilePlus, IconFolder, IconFolderOpen, IconFolderPlus } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';

import { answerKeys, useApi } from '../api/useApi';
import { isMarkdown } from '../paths';
import { usePlatform } from '../platform';
import { useOptionalFileActions } from '../shell/fileActionsContext';
import { useNav } from '../shell/NavContext';
import { SyncBadge } from '../shell/SyncBadge';

import { AsyncContent } from './AsyncContent';
import { DocumentBody } from './DocumentBody';
import { DocumentHtml } from './DocumentHtml';
import { EmptyState } from './EmptyState';

export interface DirectoryViewProps {
  path: string;
}

export function DirectoryView({ path }: DirectoryViewProps): JSX.Element {
  const { canWrite } = useNav();
  const actions = useOptionalFileActions();
  const { source, physicalUrl } = usePlatform();
  const state = useApi((signal) => source.dir(path, { signal }), [source, path], answerKeys.dir(path));

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
              <EmptyState
                testId="dir-empty"
                icon={IconFolderOpen}
                title="This folder is empty"
                actions={
                  canWrite && actions !== undefined && (
                    <>
                      <Button
                        data-testid="dir-empty-new-page"
                        leftSection={<IconFilePlus size={16} />}
                        onClick={() => actions.createPage(path)}
                      >
                        New file
                      </Button>
                      <Button
                        data-testid="dir-empty-new-folder"
                        variant="default"
                        leftSection={<IconFolderPlus size={16} />}
                        onClick={() => actions.createFolder(path)}
                      >
                        New folder
                      </Button>
                    </>
                  )
                }
              >
                {canWrite ? 'Create the first file or folder in it.' : 'There are no files or folders in it.'}
              </EmptyState>
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
                        {/* a row is a route of the app only when it is a
                            folder or a note; anything else is the /raw/ url
                            the server wrote, which the browser fetches
                            directly and the client has to mount itself */}
                        {entry.is_dir || isMarkdown(entry.path) ? (
                          <Anchor data-testid="dir-row-name" component={Link} to={entry.url}>
                            {entry.name}
                          </Anchor>
                        ) : (
                          <Anchor data-testid="dir-row-name" href={physicalUrl(entry.url)}>
                            {entry.name}
                          </Anchor>
                        )}
                      </Table.Td>
                      {/* a directory listing is the only surface that shows
                          attachments, and with a remote an unpushed image is a
                          real case that /raw/ has no chrome to warn about */}
                      <Table.Td w={28}>
                        <SyncBadge path={entry.path} />
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
