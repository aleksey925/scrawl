import { Anchor } from '@mantine/core';
import type { JSX } from 'react';

import { answerKeys, useApi } from '../api/useApi';
import { usePlatform } from '../platform';
import { useReaderExtensions } from '../shell/extensions';

import { AsyncContent } from './AsyncContent';
import { DocumentBody } from './DocumentBody';
import { MissingNote } from './MissingNote';
import { Page, PageTitle } from './Page';

export interface DocumentViewProps {
  path: string;
}

export function DocumentView({ path }: DocumentViewProps): JSX.Element {
  const { source, physicalUrl } = usePlatform();
  const { FileView } = useReaderExtensions();
  const state = useApi((signal) => source.page(path, { signal }), [source, path], answerKeys.page(path));

  return (
    <AsyncContent state={state} testId="doc" page>
      {(page) => {
        switch (page.kind) {
          case 'missing-document':
            return <MissingNote path={path} page={page} />;
          case 'file':
            // only the app gives a file a page; anywhere else it is its bytes
            return FileView !== undefined ? (
              <FileView file={page} />
            ) : (
              <Page>
                <PageTitle>{page.name}</PageTitle>
                <Anchor href={physicalUrl(page.raw_url)}>Open the file</Anchor>
              </Page>
            );
          default:
            return <DocumentBody doc={page} />;
        }
      }}
    </AsyncContent>
  );
}
