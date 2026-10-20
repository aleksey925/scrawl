import { Button } from '@mantine/core';
import { IconFileText, IconPencil } from '@tabler/icons-react';
import { useEffect, useRef, type JSX } from 'react';
import { Link } from 'react-router';

import type { DocumentResponse } from '../api/types';
import { useReaderExtensions } from '../shell/extensions';
import { useNav } from '../shell/NavContext';
import { basenameOf } from '../shell/naming';
import { chromeOf, usePageChrome } from '../shell/PageChrome';
import { useRecentNotes } from '../shell/recentNotes';
import { layout } from '../theme';

import { DocumentHtml } from './DocumentHtml';
import { EmptyState } from './EmptyState';
import { Page } from './Page';

export interface DocumentBodyProps {
  doc: DocumentResponse;
}

// a note's leading heading is its page title, so the page draws the title
// itself and the topbar repeats it only once it has scrolled away
const leadingHeading = /^\s*<h1[\s>]/;

export function DocumentBody({ doc }: DocumentBodyProps): JSX.Element {
  const { canWrite } = useNav();
  const { DocumentExtras } = useReaderExtensions();
  usePageChrome(chromeOf(doc.breadcrumbs, doc.title, leadingHeading.test(doc.html)));
  const { remember } = useRecentNotes();
  useEffect(() => remember({ path: doc.path, title: doc.title }), [remember, doc.path, doc.title]);
  const placed = useRef(false);

  return (
    <>
      {DocumentExtras !== undefined && <DocumentExtras doc={doc} placed={placed} />}

      <Page data-testid="note">
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
                  leftSection={<IconPencil size={layout.iconSizeSmall} />}
                >
                  Start writing
                </Button>
              )
            }
          >
            {`Nothing has been written in ${basenameOf(doc.path)} yet.`}
          </EmptyState>
        ) : (
          <DocumentHtml html={doc.html} toc={doc.show_toc ? doc.toc : undefined} placed={placed} />
        )}
      </Page>
    </>
  );
}
