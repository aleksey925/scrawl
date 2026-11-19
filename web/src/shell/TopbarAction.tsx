import { ActionIcon, Button } from '@mantine/core';
import type { JSX, MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router';

import type { Icon } from '../icons';
import { layout } from '../theme';

export interface TopbarActionProps {
  testId: string;
  label: string;
  to: string;
  icon?: Icon;
  state?: unknown;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
}

export function TopbarAction({ testId, label, icon: Icon, to, state, onClick }: TopbarActionProps): JSX.Element {
  const renderRoot = (props: Record<string, unknown>): ReactNode => <Link to={to} state={state} {...props} />;

  if (Icon !== undefined) {
    return (
      <ActionIcon
        data-testid={testId}
        variant="subtle"
        color="gray"
        size="lg"
        aria-label={label}
        title={label}
        onClick={onClick}
        renderRoot={renderRoot}
      >
        <Icon size={layout.iconSize} />
      </ActionIcon>
    );
  }
  return (
    <Button data-testid={testId} variant="subtle" color="gray" size="sm" onClick={onClick} renderRoot={renderRoot}>
      {label}
    </Button>
  );
}
