import { Container } from '@mantine/core';
import type { JSX, ReactNode } from 'react';

// one column for every screen the app has, the whole width beside the tree, so
// nothing moves sideways from a note to a search or a directory
export function PageContainer({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Container fluid px={0} miw={0}>
      {children}
    </Container>
  );
}
