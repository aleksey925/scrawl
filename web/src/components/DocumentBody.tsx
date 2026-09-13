import { Button } from '@mantine/core';
import { IconHistory, IconPencil } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';

import type { DocumentResponse } from '../api/types';
import { historyUrl } from '../paths';
import { PageActions, PageToc } from '../shell/ShellSlots';
import { TocList } from '../shell/TocList';

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

      {doc.show_toc && doc.toc.length > 0 && (
        <PageToc>
          <TocList headings={doc.toc} />
        </PageToc>
      )}

      <DocumentHtml html={doc.html} />
    </>
  );
}
