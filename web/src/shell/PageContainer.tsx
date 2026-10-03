import { Container } from '@mantine/core';
import type { JSX, ReactNode } from 'react';

import { layout, layoutBreakpoints } from '../theme';

// one column for every screen the app has, so the text does not move sideways
// from a note to a search or a directory. Where the column takes the whole
// width it keeps GitHub's 32px from the edge, the shell's padding plus this
export function PageContainer({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Container size={layout.contentMeasure} px={{ base: 'lg', [layoutBreakpoints.sidebar]: 0 }} miw={0}>
      {children}
    </Container>
  );
}
