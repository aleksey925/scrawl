import { Button } from '@mantine/core';
import { IconHistory, IconPencil } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';

import type { DocumentResponse } from '../api/types';
import { ReadingAnchorTracker } from '../editor';
import { historyUrl } from '../paths';
import { useNav } from '../shell/NavContext';
import { PageActions } from '../shell/ShellSlots';

import { DocumentHtml } from './DocumentHtml';

export interface DocumentBodyProps {
  doc: DocumentResponse;
}

export function DocumentBody({ doc }: DocumentBodyProps): JSX.Element {
  const { canWrite } = useNav();

  return (
    <>
      <PageActions>
        {canWrite && (
          <Button
            data-testid="doc-edit"
            component={Link}
            to={doc.edit_url}
            variant="default"
            size="xs"
            leftSection={<IconPencil size={16} />}
          >
            Edit
          </Button>
        )}
        {/* reading the versions is a read, so it stays where writing does not */}
        <Button
          data-testid="doc-history"
          component={Link}
          to={historyUrl(doc.doc_path)}
          variant="subtle"
          color="gray"
          size="xs"
          leftSection={<IconHistory size={16} />}
        >
          History
        </Button>
      </PageActions>

      {/* records where the reader was, so the editor opens in the same place */}
      <ReadingAnchorTracker path={doc.doc_path} rev={doc.rev} />

      <DocumentHtml html={doc.html} toc={doc.show_toc ? doc.toc : undefined} />
    </>
  );
}
