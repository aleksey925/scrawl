import { ActionIcon, Button } from '@mantine/core';
import type { Icon } from '../icons';
import type { ComponentPropsWithRef, JSX, ReactNode } from 'react';
import { Link } from 'react-router';

import { layout, layoutBreakpoints, useAtLeast } from '../theme';

// the rest is what a mantine Menu.Target hands its button: a ref, the click
// that opens it and the aria state of the menu
export interface TopbarActionProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'color'> {
  testId: string;
  label: string;
  icon: Icon;
  to?: string;
  // iconOnly keeps the icon with the label as its tooltip on a wide screen too,
  // for an action the bar names by a picture the way Notion does History
  iconOnly?: boolean;
}

// TopbarAction is a page action in the topbar: a quiet word, and on a phone
// an icon named by its label
export function TopbarAction({ testId, label, icon: Icon, to, iconOnly = false, ...rest }: TopbarActionProps): JSX.Element {
  const wide = useAtLeast(layoutBreakpoints.compactTopbar);
  const renderRoot =
    to === undefined ? undefined : (props: Record<string, unknown>): ReactNode => <Link to={to} {...props} />;

  if (!wide || iconOnly) {
    return (
      <ActionIcon
        {...rest}
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
    <Button
      {...rest}
      data-testid={testId}
      variant="subtle"
      color="gray"
      size="sm"
      renderRoot={renderRoot}
    >
      {label}
    </Button>
  );
}
