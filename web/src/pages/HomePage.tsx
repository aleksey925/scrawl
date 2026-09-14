import { Container } from '@mantine/core';
import type { JSX } from 'react';

import { DirectoryView } from '../components/DirectoryView';
import { layout } from '../theme';

export function Component(): JSX.Element {
  return (
    <Container size={layout.contentMeasure} px={0}>
      <DirectoryView path="" />
    </Container>
  );
}
