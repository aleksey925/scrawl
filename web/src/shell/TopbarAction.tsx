import { ActionIcon, Button } from '@mantine/core';
import type { TablerIcon } from '@tabler/icons-react';
import type { ComponentPropsWithRef, JSX, ReactNode } from 'react';
import { Link } from 'react-router';

import { layout, layoutBreakpoints, useAtLeast } from '../theme';

// the rest is what a mantine Menu.Target hands its button: a ref, the click
// that opens it and the aria state of the menu
export interface TopbarActionProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'color'> {
  testId: string;
  label: string;
  icon: TablerIcon;
  to?: string;
}

// TopbarAction is a page action in the topbar: a quiet labelled button, and
// on a phone an icon named by its label
export function TopbarAction({ testId, label, icon: Icon, to, ...rest }: TopbarActionProps): JSX.Element {
  const wide = useAtLeast(layoutBreakpoints.compactTopbar);
  const renderRoot =
    to === undefined ? undefined : (props: Record<string, unknown>): ReactNode => <Link to={to} {...props} />;

  if (!wide) {
    return (
      <ActionIcon
        {...rest}
        data-testid={testId}
        variant="subtle"
        color="gray"
        size="lg"
        aria-label={label}
        renderRoot={renderRoot}
      >
        <Icon size={layout.iconSize} />
      </ActionIcon>
    );
  }
  return (
    <Button
      {...rest}
      data-testid={testId}
      variant="subtle"
      color="gray"
      size="sm"
      leftSection={<Icon size={layout.iconSizeSmall} />}
      renderRoot={renderRoot}
    >
      {label}
    </Button>
  );
}
