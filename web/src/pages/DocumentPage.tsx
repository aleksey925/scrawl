import type { JSX } from 'react';
import { useParams } from 'react-router';

import { DirectoryView } from '../components/DirectoryView';
import { DocumentView } from '../components/DocumentView';
import { isDirectoryPath, trimTrailingSlash } from '../paths';
import { PageContainer } from '../shell/PageContainer';

export function Component(): JSX.Element {
  const params = useParams();
  const path = decodeURIComponent(params['*'] ?? '');

  return (
    <PageContainer>
      {isDirectoryPath(path) ? (
        <DirectoryView path={trimTrailingSlash(path)} />
      ) : (
        <DocumentView path={path} />
      )}
    </PageContainer>
  );
}
