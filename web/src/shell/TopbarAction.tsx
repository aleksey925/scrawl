import { ActionIcon, Button } from '@mantine/core';
import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router';

import type { Icon } from '../icons';
import { layout } from '../theme';

export interface TopbarActionProps {
  testId: string;
  label: string;
  to: string;
  // icon replaces the word, with the label as its tooltip, for an action the
  // bar names by a picture the way Notion does History
  icon?: Icon;
}

// TopbarAction is a page action in the topbar: a quiet word that leads to a
// route, or its icon named by the label
export function TopbarAction({ testId, label, icon: Icon, to }: TopbarActionProps): JSX.Element {
  const renderRoot = (props: Record<string, unknown>): ReactNode => <Link to={to} {...props} />;

  if (Icon !== undefined) {
    return (
      <ActionIcon
        data-testid={testId}
        variant="subtle"
        color="gray"
        size="lg"
        aria-label={label}
        title={label}
        renderRoot={renderRoot}
      >
        <Icon size={layout.iconSize} />
      </ActionIcon>
    );
  }
  return (
    <Button data-testid={testId} variant="subtle" color="gray" size="sm" renderRoot={renderRoot}>
      {label}
    </Button>
  );
}
