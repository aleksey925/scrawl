import { ActionIcon, Button } from '@mantine/core';
import type { TablerIcon } from '@tabler/icons-react';
import type { ComponentPropsWithRef, JSX, ReactNode } from 'react';
import { Link } from 'react-router';

import { layout, layoutBreakpoints, useAtLeast } from '../theme';

import { useActionPlace } from './ShellSlots';

// the rest is what a mantine Menu.Target hands its button: a ref, the click
// that opens it and the aria state of the menu
export interface TopbarActionProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'color'> {
  testId: string;
  label: string;
  icon: TablerIcon;
  to?: string;
  // the page's main action is the filled button; on a phone every action is
  // the same bare icon
  primary?: boolean;
}

// TopbarAction is a page action: a small button in the head of a note's card,
// a labelled one in a wide topbar, an icon named by its label on a phone
export function TopbarAction({
  testId, label, icon: Icon, to, primary = false, ...rest
}: TopbarActionProps): JSX.Element {
  const wide = useAtLeast(layoutBreakpoints.compactTopbar);
  const place = useActionPlace();
  const renderRoot =
    to === undefined ? undefined : (props: Record<string, unknown>): ReactNode => <Link to={to} {...props} />;

  if (place === 'head') {
    return (
      <Button
        {...rest}
        data-testid={testId}
        variant={primary ? 'filled' : 'default'}
        size="xs"
        leftSection={<Icon size={14} />}
        renderRoot={renderRoot}
      >
        {label}
      </Button>
    );
  }
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
        <Icon size={layout.topbarIconSize} />
      </ActionIcon>
    );
  }
  return (
    <Button
      {...rest}
      data-testid={testId}
      variant={primary ? 'filled' : 'subtle'}
      color={primary ? undefined : 'gray'}
      size="sm"
      leftSection={<Icon size={16} />}
      renderRoot={renderRoot}
    >
      {label}
    </Button>
  );
}
