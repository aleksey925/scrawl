import { Anchor, Box, Stack, Text } from '@mantine/core';
import { useEffect, useState, type JSX } from 'react';

import type { Heading } from '../api/types';

export interface TocListProps {
  headings: Heading[];
}

// activeOffset is how far down the viewport a heading counts as the one being
// read. A heading exactly at the top edge reads as the previous section still,
// because its first paragraph is what fills the screen.
const activeOffset = 140;

// useActiveHeading follows the reader down the page. It measures rather than
// observes intersections: a long section leaves no heading on screen at all,
// and an observer then has nothing to report while the answer is simply the
// last heading above the fold.
function useActiveHeading(headings: Heading[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (headings.length === 0) {
      return;
    }
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      let seen: string | undefined = headings[0]?.id;
      for (const heading of headings) {
        const box = document.getElementById(heading.id)?.getBoundingClientRect();
        if (box === undefined || box.top > activeOffset) {
          break;
        }
        seen = heading.id;
      }
      setActive(seen);
    };
    // a wheel sends an event a frame and a long note has hundreds of blocks
    const onScroll = (): void => {
      if (frame === 0) {
        frame = requestAnimationFrame(measure);
      }
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [headings]);

  return active;
}

export function TocList({ headings }: TocListProps): JSX.Element {
  const active = useActiveHeading(headings);
  // the shallowest heading a note actually uses is the left edge of the rail,
  // so a note whose sections are all h2 does not sit indented for nothing
  const top = headings.reduce((min, heading) => Math.min(min, heading.level), 6);

  return (
    <Stack data-testid="toc" gap={0}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb="xs">
        On this page
      </Text>
      <Box style={{ borderLeft: '1px solid var(--mantine-color-default-border)' }}>
        {headings.map((heading) => (
          <Anchor
            key={heading.id}
            data-testid="toc-entry"
            data-level={heading.level}
            data-active={heading.id === active ? 'true' : 'false'}
            href={`#${heading.id}`}
            size="sm"
            display="block"
            c={heading.id === active ? 'var(--scrawl-accent)' : 'dimmed'}
            underline="never"
            lh={1.35}
            py={4}
            pr="xs"
            style={{
              // the indent is the nesting, and the rail is the marker: one line
              // moves from grey to the accent instead of the row changing shape
              paddingLeft: 12 + Math.max(0, heading.level - top) * 12,
              marginLeft: -1,
              borderLeft: `2px solid ${heading.id === active ? 'var(--scrawl-accent)' : 'transparent'}`,
              transition: 'color 120ms ease, border-color 120ms ease',
            }}
          >
            {heading.text}
          </Anchor>
        ))}
      </Box>
    </Stack>
  );
}
