import { Button } from '@mantine/core';
import { IconFileText, IconPencil } from '@tabler/icons-react';
import { useRef, type JSX } from 'react';
import { Link } from 'react-router';

import type { DocumentResponse } from '../api/types';
import { useReaderExtensions } from '../shell/extensions';
import { useCurrentDoc, useNav } from '../shell/NavContext';
import { basenameOf } from '../shell/naming';

import { DocumentHtml } from './DocumentHtml';
import { EmptyState } from './EmptyState';

export interface DocumentBodyProps {
  doc: DocumentResponse;
}

export function DocumentBody({ doc }: DocumentBodyProps): JSX.Element {
  const { canWrite } = useNav();
  const { DocumentExtras } = useReaderExtensions();
  // the file, not the route: a directory holding an index.md is served under
  // the directory's own address, and the root is that case with an empty path
  useCurrentDoc(doc.doc_path);
  const placed = useRef(false);

  return (
    <>
      {DocumentExtras !== undefined && <DocumentExtras doc={doc} placed={placed} />}

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
