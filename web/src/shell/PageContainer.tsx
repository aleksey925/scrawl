import { Container } from '@mantine/core';
import type { JSX, ReactNode } from 'react';

import { layout } from '../theme';

// one column for every screen the app has, so the text does not move sideways
// from a note to a search or a directory: as wide as a note card around the
// measure of its text
export function PageContainer({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Container size={layout.contentMeasure + 2 * layout.notePadding} px={0} miw={0}>
      {children}
    </Container>
  );
}
