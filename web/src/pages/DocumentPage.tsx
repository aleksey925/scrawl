import { Container } from '@mantine/core';
import type { JSX } from 'react';
import { useParams } from 'react-router';

import { DirectoryView } from '../components/DirectoryView';
import { DocumentView } from '../components/DocumentView';
import { isDirectoryPath, trimTrailingSlash } from '../paths';
import { layout } from '../theme';

export function Component(): JSX.Element {
  const params = useParams();
  const path = decodeURIComponent(params['*'] ?? '');

  return (
    <Container size={layout.contentMeasure} px={0}>
      {isDirectoryPath(path) ? (
        <DirectoryView path={trimTrailingSlash(path)} />
      ) : (
        <DocumentView path={path} />
      )}
    </Container>
  );
}
