import { Group, Stack, Text, Title } from '@mantine/core';
import type { ComponentType, JSX, ReactNode } from 'react';

const iconSize = 32;

export interface EmptyStateProps {
  testId: string;
  icon: ComponentType<{ size?: number; stroke?: number }>;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}

// EmptyState says what is selected when there is nothing in it to show: a
// blank screen reads as a page that failed to load
export function EmptyState({ testId, icon: Icon, title, children, actions }: EmptyStateProps): JSX.Element {
  return (
    <Stack data-testid={testId} align="center" gap="sm" py="5xl" px="lg" ta="center">
      <Text c="dimmed" lh={1} aria-hidden>
        <Icon size={iconSize} stroke={1.5} />
      </Text>
      <Title data-testid={`${testId}-title`} order={2} size="h3">
        {title}
      </Title>
      {children !== undefined && (
        <Text c="dimmed" maw={420} style={{ overflowWrap: 'anywhere' }}>
          {children}
        </Text>
      )}
      {Boolean(actions) && (
        <Group gap="sm" justify="center" mt="sm">
          {actions}
        </Group>
      )}
    </Stack>
  );
}
