import { Anchor, Stack, Text } from '@mantine/core';
import { useEffect, useRef, type JSX, type MouseEvent } from 'react';

import { layoutBreakpoints, useAtLeast } from '../theme';

import type { Outline } from './useOutline';

export interface ReaderTocProps {
  outline: Outline;
}

function scrollParent(from: HTMLElement): HTMLElement | null {
  for (let at = from.parentElement; at !== null; at = at.parentElement) {
    if (at.scrollHeight > at.clientHeight && /auto|scroll/.test(getComputedStyle(at).overflowY)) {
      return at;
    }
  }
  return null;
}

function useKeepInView(activeId: string | null): (node: HTMLAnchorElement | null) => void {
  const active = useRef<HTMLAnchorElement | null>(null);
  const set = (node: HTMLAnchorElement | null): void => {
    active.current = node;
  };

  useEffect(() => {
    const node = active.current;
    if (node === null) {
      return;
    }
    const host = scrollParent(node);
    if (host === null) {
      return;
    }
    const box = node.getBoundingClientRect();
    const hostBox = host.getBoundingClientRect();
    if (box.top >= hostBox.top && box.bottom <= hostBox.bottom) {
      return;
    }
    host.scrollTo({
      top: host.scrollTop + box.top - hostBox.top - (host.clientHeight - box.height) / 2,
      behavior: 'smooth',
    });
  }, [activeId]);

  return set;
}

const indentStep = 14;

export function ReaderToc({ outline }: ReaderTocProps): JSX.Element {
  const floating = useAtLeast(layoutBreakpoints.miniOutline);
  const top = outline.entries.reduce((min, entry) => Math.min(min, entry.level), 6);
  const keepInView = useKeepInView(outline.activeId);

  return (
    <Stack data-testid="toc" gap={0}>
      {floating && (
        <Text size="xs" c="dimmed" fw={500} mb="xs" px={8}>
          On this page
        </Text>
      )}
      <Stack gap={2}>
        {outline.entries.map((entry) => {
          const active = entry.id === outline.activeId;
          const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
            event.preventDefault();
            outline.select(entry.id);
          };
          return (
            <Anchor
              key={entry.id}
              ref={active ? keepInView : undefined}
              data-testid="toc-entry"
              data-active={active ? 'true' : 'false'}
              data-level={entry.level}
              href={`#${encodeURIComponent(entry.id)}`}
              onClick={onClick}
              size={floating ? '13px' : 'md'}
              c={active ? 'accent' : floating ? 'dimmed' : 'var(--scrawl-text)'}
              fw={active ? 500 : 400}
              underline="never"
              style={{
                display: 'flex',
                alignItems: 'center',
                minHeight: floating ? undefined : 'var(--scrawl-tap-target)',
                paddingTop: floating ? 5 : 0,
                paddingBottom: floating ? 5 : 0,
                paddingLeft: 8 + Math.max(0, entry.level - top) * indentStep,
                paddingRight: 8,
                borderRadius: 'var(--mantine-radius-md)',
                lineHeight: 1.3,
                transition: 'color 120ms ease',
              }}
            >
              {entry.text}
            </Anchor>
          );
        })}
      </Stack>
    </Stack>
  );
}
