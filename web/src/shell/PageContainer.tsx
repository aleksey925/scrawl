import { Box } from '@mantine/core';
import type { JSX, ReactNode } from 'react';

import { layout } from '../theme';

// The reading measure caps the column but does not centre it: centred, it put
// as much empty space between the sidebar and the text as between the text and
// the edge of the window, and the wider the screen the worse it read.
export function PageContainer({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Box maw={layout.contentMeasure} miw={0}>
      {children}
    </Box>
  );
}
