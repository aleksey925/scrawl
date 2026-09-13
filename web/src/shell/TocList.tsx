import { Anchor, Stack, Text } from '@mantine/core';
import type { JSX } from 'react';

import type { Heading } from '../api/types';

export interface TocListProps {
  headings: Heading[];
}

export function TocList({ headings }: TocListProps): JSX.Element {
  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        On this page
      </Text>
      {headings.map((heading) => (
        <Anchor
          key={heading.id}
          href={`#${heading.id}`}
          size="sm"
          c="dimmed"
          pl={heading.level > 2 ? 'md' : undefined}
        >
          {heading.text}
        </Anchor>
      ))}
    </Stack>
  );
}
