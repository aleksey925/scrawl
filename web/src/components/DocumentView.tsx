import { Button, Group } from '@mantine/core';
import { IconFileOff, IconPlus } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';

import { answerKeys, useApi } from '../api/useApi';
import { editUrl } from '../paths';
import { usePlatform } from '../platform';
import { NoteCrumbs } from '../shell/PathCrumbs';
import { SyncBadge } from '../shell/SyncBadge';

import { AsyncContent } from './AsyncContent';
import { DocumentBody } from './DocumentBody';
import { EmptyState } from './EmptyState';
import { NoteCard } from './NoteCard';

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
          <NoteCard
            header={
              <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                <NoteCrumbs />
                {/* a deletion that failed to push leaves the note gone here and
                    present on the remote, and this is the screen that says so */}
                <SyncBadge path={path} />
              </Group>
            }
          >
            <EmptyState
              testId="doc-missing"
              icon={IconFileOff}
              title={page.title}
              actions={
                page.can_create && (
                  <Button
                    data-testid="doc-create"
                    component={Link}
                    to={editUrl(path)}
                    leftSection={<IconPlus size={16} />}
                  >
                    Create it
                  </Button>
                )
              }
            >
              This note does not exist yet.
            </EmptyState>
          </NoteCard>
        ) : (
          <DocumentBody doc={page} />
        )
      }
    </AsyncContent>
  );
}
