import { ActionIcon, Affix, Group, Paper, Text } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconX } from '@tabler/icons-react';
import { useEffect, type JSX } from 'react';

import { layout } from '../theme';

export interface FindBarProps {
  position: number;
  total: number;
  onStep: (delta: number) => void;
  onClose: () => void;
}

export function FindBar({ position, total, onStep, onClose }: FindBarProps): JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <Affix
      position={{ bottom: 'calc(var(--mantine-spacing-lg) + env(safe-area-inset-bottom))', left: '50%' }}
      style={{ transform: 'translateX(-50%)' }}
    >
      <Paper withBorder shadow="lg" radius="xl" p={4} role="status">
        <Group gap={4} wrap="nowrap" pl="sm">
          <Text size="sm" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {position} of {total}
          </Text>
          <ActionIcon
            variant="subtle"
            color="gray"
            size={layout.tapTarget}
            radius="xl"
            aria-label="Previous match"
            onClick={() => onStep(-1)}
          >
            <IconChevronUp size={18} />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            color="gray"
            size={layout.tapTarget}
            radius="xl"
            aria-label="Next match"
            onClick={() => onStep(1)}
          >
            <IconChevronDown size={18} />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            color="gray"
            size={layout.tapTarget}
            radius="xl"
            aria-label="Clear highlighting"
            onClick={onClose}
          >
            <IconX size={18} />
          </ActionIcon>
        </Group>
      </Paper>
    </Affix>
  );
}
