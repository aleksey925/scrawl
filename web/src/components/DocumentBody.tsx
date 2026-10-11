import { Button } from '@mantine/core';
import { IconFileText, IconHistory, IconPencil } from '@tabler/icons-react';
import { useRef, type JSX } from 'react';
import { Link } from 'react-router';

import type { DocumentResponse } from '../api/types';
import { ReadingAnchorTracker } from '../editor';
import { historyUrl } from '../paths';
import { useCurrentDoc, useNav } from '../shell/NavContext';
import { PageActions } from '../shell/ShellSlots';
import { TopbarAction } from '../shell/TopbarAction';
import { basenameOf } from '../shell/naming';

import { DocumentHtml } from './DocumentHtml';
import { EmptyState } from './EmptyState';

export interface DocumentBodyProps {
  doc: DocumentResponse;
}

export function DocumentBody({ doc }: DocumentBodyProps): JSX.Element {
  const { canWrite } = useNav();
  // the file, not the route: a directory holding an index.md is served under
  // the directory's own address, and the root is that case with an empty path
  useCurrentDoc(doc.doc_path);
  const placed = useRef(false);

  return (
    <>
      <PageActions>
        {canWrite && <TopbarAction testId="doc-edit" label="Edit" icon={IconPencil} to={doc.edit_url} primary />}
        {/* reading the versions is a read, so it stays where writing does not */}
        <TopbarAction testId="doc-history" label="History" icon={IconHistory} to={historyUrl(doc.doc_path)} />
      </PageActions>

      {/* records where the reader was, so the editor opens in the same place */}
      <ReadingAnchorTracker path={doc.doc_path} rev={doc.rev} placed={placed} />

      {doc.html.trim() === '' ? (
        <EmptyState
          testId="doc-empty"
          icon={IconFileText}
          title="This note is empty"
          actions={
            canWrite && (
              <Button
                data-testid="doc-empty-edit"
                component={Link}
                to={doc.edit_url}
                leftSection={<IconPencil size={16} />}
              >
                Start writing
              </Button>
            )
          }
        >
          {`Nothing has been written in ${basenameOf(doc.doc_path)} yet.`}
        </EmptyState>
      ) : (
        <DocumentHtml html={doc.html} toc={doc.show_toc ? doc.toc : undefined} placed={placed} />
      )}
    </>
  );
}
