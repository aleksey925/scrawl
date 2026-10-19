import { Anchor, Button, Stack, Text } from '@mantine/core';
import { IconFile, IconFilePlus, IconFolder, IconFolderOpen, IconFolderPlus } from '@tabler/icons-react';
import type { JSX } from 'react';

import type { DirEntry } from '../api/types';
import { Link } from 'react-router';

import { answerKeys, useApi } from '../api/useApi';
import { isMarkdown } from '../paths';
import { usePlatform } from '../platform';
import { useOptionalFileActions } from '../shell/fileActionsContext';
import { useNav } from '../shell/NavContext';
import { NoteCrumbs } from '../shell/PathCrumbs';
import { SyncBadge } from '../shell/SyncBadge';

import { AsyncContent } from './AsyncContent';
import { DocumentBody } from './DocumentBody';
import { DocumentHtml } from './DocumentHtml';
import { EmptyState } from './EmptyState';
import { NoteCard } from './NoteCard';
import { PageCard } from './PageCard';
import rows from './rows.module.css';

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
            {dir.entries.length === 0 ? (
              <NoteCard header={<DirHead path={path} title={dir.title} entries={dir.entries} />}>
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
              </NoteCard>
            ) : (
              <PageCard
                data-testid="dir-table"
                wide
                header={<DirHead path={path} title={dir.title} entries={dir.entries} />}
              >
                {dir.entries.map((entry) => (
                  <div
                    key={entry.path}
                    data-testid="dir-row"
                    data-path={entry.path}
                    data-dir={entry.is_dir ? 'true' : 'false'}
                    className={rows.row}
                  >
                    {entry.is_dir ? (
                      <IconFolder size={18} className={rows.icon} aria-hidden />
                    ) : (
                      <IconFile size={18} className={rows.icon} aria-hidden />
                    )}
                    <span className={rows.body}>
                      {/* a row is a route of the app only when it is a folder
                          or a note; anything else is the /raw/ url the server
                          wrote, which the browser fetches directly and the
                          client has to mount itself */}
                      {entry.is_dir || isMarkdown(entry.path) ? (
                        <Anchor data-testid="dir-row-name" component={Link} to={entry.url} c="var(--scrawl-text)">
                          {entry.name}
                        </Anchor>
                      ) : (
                        <Anchor data-testid="dir-row-name" href={physicalUrl(entry.url)} c="var(--scrawl-text)">
                          {entry.name}
                        </Anchor>
                      )}
                    </span>
                    {/* a directory listing is the only surface that shows
                        attachments, and with a remote an unpushed image is a
                        real case that /raw/ has no chrome to warn about */}
                    <SyncBadge path={entry.path} />
                  </div>
                ))}
              </PageCard>
            )}
            {dir.has_readme && (
              <NoteCard>
                <DocumentHtml html={dir.readme_html} />
              </NoteCard>
            )}
          </Stack>
        )
      }
    </AsyncContent>
  );
}

// DirHead is the head of a folder's card: the path to it, or at the root,
// which has no path, the name of the space, and what the folder holds
function DirHead({ path, title, entries }: { path: string; title: string; entries: readonly DirEntry[] }): JSX.Element {
  return (
    <>
      {path === '' ? (
        <Text data-testid="dir-title" size="sm" fw={500} c="var(--scrawl-text)">
          {title}
        </Text>
      ) : (
        <NoteCrumbs />
      )}
      {entries.length > 0 && (
        <Text data-testid="dir-count" size="sm" c="dimmed" style={{ flex: 'none' }}>
          {countOf(entries)}
        </Text>
      )}
    </>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

// countOf says what a folder holds the way the tree sorts it: notes, folders,
// and the files that are neither
function countOf(entries: readonly DirEntry[]): string {
  const folders = entries.filter((entry) => entry.is_dir).length;
  const notes = entries.filter((entry) => !entry.is_dir && isMarkdown(entry.path)).length;
  const files = entries.length - folders - notes;
  const parts = [
    notes > 0 ? plural(notes, 'note', 'notes') : '',
    folders > 0 ? plural(folders, 'folder', 'folders') : '',
    files > 0 ? plural(files, 'file', 'files') : '',
  ];
  return parts.filter((part) => part !== '').join(' · ');
}
