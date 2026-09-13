import { Button } from '@mantine/core';
import { IconHistory, IconPencil } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';

import type { DocumentResponse } from '../api/types';
import { ReadingAnchorTracker } from '../editor';
import { historyUrl } from '../paths';
import { PageActions } from '../shell/ShellSlots';

import { DocumentHtml } from './DocumentHtml';

export interface DocumentBodyProps {
  doc: DocumentResponse;
}

export function DocumentBody({ doc }: DocumentBodyProps): JSX.Element {
  return (
    <>
      <PageActions>
        <Button
          component={Link}
          to={doc.edit_url}
          variant="default"
          size="xs"
          leftSection={<IconPencil size={16} />}
        >
          Edit
        </Button>
        <Button
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
