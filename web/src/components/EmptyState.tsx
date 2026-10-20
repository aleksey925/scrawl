import { Group, Stack, Text, Title } from '@mantine/core';
import type { ComponentType, JSX, ReactNode } from 'react';

const iconSize = 32;

export interface EmptyStateProps {
  testId: string;
  icon: ComponentType<{ size?: number }>;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}

// EmptyState says what is selected when there is nothing in it to show: a
// blank screen reads as a page that failed to load
export function EmptyState({ testId, icon: Icon, title, children, actions }: EmptyStateProps): JSX.Element {
  return (
    <Stack data-testid={testId} align="center" gap={6} py="4xl" px="lg" ta="center">
      <Text lh={1} mb={6} style={{ color: 'var(--scrawl-icon-tertiary)' }} aria-hidden>
        <Icon size={iconSize} />
      </Text>
      <Title data-testid={`${testId}-title`} order={2} fz="md" fw={600}>
        {title}
      </Title>
      {children !== undefined && (
        <Text c="dimmed" fz="sm" maw={420} style={{ overflowWrap: 'anywhere' }}>
          {children}
        </Text>
      )}
      {Boolean(actions) && (
        <Group gap="xs" justify="center" mt="sm">
          {actions}
        </Group>
      )}
    </Stack>
  );
}
