import type { JSX } from 'react';

import { answerKeys, useApi } from '../api/useApi';
import { usePlatform } from '../platform';
import { useReaderExtensions } from '../shell/extensions';

import { AsyncContent } from './AsyncContent';
import { DocumentBody } from './DocumentBody';
import { MissingNote } from './MissingNote';

export interface DocumentViewProps {
  path: string;
}

export function DocumentView({ path }: DocumentViewProps): JSX.Element {
  const { source } = usePlatform();
  const { FileView } = useReaderExtensions();
  const state = useApi((signal) => source.page(path, { signal }), [source, path], answerKeys.page(path));

  return (
    <AsyncContent state={state} testId="doc" page>
      {(page) => {
        switch (page.kind) {
          case 'missing-document':
            return <MissingNote path={page.path} page={page} />;
          case 'file':
            return FileView === undefined ? null : <FileView file={page} />;
          default:
            return <DocumentBody doc={page} />;
        }
      }}
    </AsyncContent>
  );
}
