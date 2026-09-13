import { Anchor, Stack, Text } from '@mantine/core';
import type { JSX, MouseEvent } from 'react';

import type { Outline } from './useOutline';

export interface ReaderTocProps {
  outline: Outline;
}

export function ReaderToc({ outline }: ReaderTocProps): JSX.Element {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb="xs">
        On this page
      </Text>
      {outline.entries.map((entry) => {
        const active = entry.id === outline.activeId;
        const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
          event.preventDefault();
          outline.select(entry.id);
        };
        return (
          <Anchor
            key={entry.id}
            href={`#${encodeURIComponent(entry.id)}`}
            onClick={onClick}
            size="sm"
            c={active ? 'accent' : 'dimmed'}
            fw={active ? 600 : 400}
            pl={entry.level > 2 ? 'md' : 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              minHeight: 'var(--scrawl-tap-target)',
              lineHeight: 1.25,
            }}
          >
            {entry.text}
          </Anchor>
        );
      })}
    </Stack>
  );
}
