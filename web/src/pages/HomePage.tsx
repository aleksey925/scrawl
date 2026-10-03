import type { JSX } from 'react';

import { DirectoryView } from '../components/DirectoryView';
import { PageContainer } from '../shell/PageContainer';

export function Component(): JSX.Element {
  return (
    <PageContainer>
      <DirectoryView path="" />
    </PageContainer>
  );
}
