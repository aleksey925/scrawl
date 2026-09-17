import { Anchor, Box, Stack, Text } from '@mantine/core';
import type { JSX, MouseEvent } from 'react';

import { layoutBreakpoints, useAtLeast } from '../theme';

import type { Outline } from './useOutline';

export interface ReaderTocProps {
  outline: Outline;
}

// indentStep is how far one level of nesting moves a heading in. It is smaller
// than a paragraph indent on purpose: the outline is read as a shape, and the
// shape is lost once the deepest entries wrap.
const indentStep = 12;

export function ReaderToc({ outline }: ReaderTocProps): JSX.Element {
  // the same question the shell asks to decide where this is rendered: a rail
  // beside the note, where a row is a line of text, or a sheet a thumb opens,
  // where a row has to be something a thumb can hit
  const rail = useAtLeast(layoutBreakpoints.tocRail);
  // the shallowest heading the note actually uses is the left edge, so a note
  // whose sections are all h2 does not sit indented for nothing
  const top = outline.entries.reduce((min, entry) => Math.min(min, entry.level), 6);

  return (
    <Stack data-testid="toc" gap={0}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb="xs">
        On this page
      </Text>
      <Box style={{ borderLeft: '1px solid var(--mantine-color-default-border)' }}>
        {outline.entries.map((entry) => {
          const active = entry.id === outline.activeId;
          const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
            event.preventDefault();
            outline.select(entry.id);
          };
          return (
            <Anchor
              key={entry.id}
              data-testid="toc-entry"
              data-active={active ? 'true' : 'false'}
              data-level={entry.level}
              href={`#${encodeURIComponent(entry.id)}`}
              onClick={onClick}
              size="sm"
              c={active ? 'accent' : 'dimmed'}
              fw={active ? 600 : 400}
              underline="never"
              style={{
                display: 'flex',
                alignItems: 'center',
                minHeight: rail ? undefined : 'var(--scrawl-tap-target)',
                paddingTop: rail ? 4 : 0,
                paddingBottom: rail ? 4 : 0,
                paddingLeft: indentStep + Math.max(0, entry.level - top) * indentStep,
                // the rail is the marker: the section being read moves one line
                // from grey to the accent instead of the row changing shape
                marginLeft: -1,
                borderLeft: `2px solid ${active ? 'var(--scrawl-accent)' : 'transparent'}`,
                lineHeight: 1.35,
                transition: 'color 120ms ease, border-color 120ms ease',
              }}
            >
              {entry.text}
            </Anchor>
          );
        })}
      </Box>
    </Stack>
  );
}
