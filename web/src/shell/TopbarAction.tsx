import { ActionIcon, Button } from '@mantine/core';
import type { TablerIcon } from '@tabler/icons-react';
import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router';

import { layout, layoutBreakpoints, useAtLeast } from '../theme';

import classes from './Topbar.module.css';

export interface TopbarActionProps {
  testId: string;
  label: string;
  icon: TablerIcon;
  to?: string;
  onClick?: () => void;
  // the page's main action gets the bordered button; on a phone every action
  // is the same bare icon
  primary?: boolean;
}

// TopbarAction is a page action in the topbar: a labelled button where the row
// has room, an icon with the label as its name on a phone
export function TopbarAction({ testId, label, icon: Icon, to, onClick, primary = false }: TopbarActionProps): JSX.Element {
  const wide = useAtLeast(layoutBreakpoints.compactTopbar);
  const renderRoot =
    to === undefined ? undefined : (props: Record<string, unknown>): ReactNode => <Link to={to} {...props} />;

  if (!wide) {
    return (
      <ActionIcon
        data-testid={testId}
        variant="subtle"
        color="gray"
        size="lg"
        aria-label={label}
        renderRoot={renderRoot}
        onClick={onClick}
      >
        <Icon size={layout.topbarIconSize} />
      </ActionIcon>
    );
  }
  return (
    <Button
      data-testid={testId}
      variant={primary ? 'default' : 'subtle'}
      color={primary ? undefined : 'gray'}
      className={primary ? classes.primary : undefined}
      size="sm"
      leftSection={<Icon size={16} />}
      renderRoot={renderRoot}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
