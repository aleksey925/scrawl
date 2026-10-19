import { ActionIcon, Indicator, Menu } from '@mantine/core';
import { IconDots } from '@tabler/icons-react';
import type { JSX, ReactNode } from 'react';

import { layout, layoutBreakpoints, useAtLeast } from '../theme';

import { ThemePicker } from './ThemePicker';

export interface MoreMenuProps {
  // alert is what is wrong with the space, which the dot on the menu stands for
  alert?: string;
  // items above the theme and below it
  before?: ReactNode;
  after?: ReactNode;
}

// MoreMenu is the one menu of the bar: on a phone in the app it holds what the
// desktop topbar keeps in two places, the sync state and the account, and
// around the theme a site has nothing else to hold. The dot on it is what
// survives scrolling while the sync is broken, the banner having scrolled away.
export function MoreMenu({ alert, before, after }: MoreMenuProps): JSX.Element {
  const wide = useAtLeast(layoutBreakpoints.compactTopbar);
  return (
    <Menu position="bottom-end" width={240} withinPortal>
      <Menu.Target>
        <ActionIcon
          data-testid="topbar-more"
          data-sync={alert === undefined ? 'false' : 'true'}
          variant={wide ? 'default' : 'subtle'}
          color="gray"
          size={wide ? layout.controlHeight : 'lg'}
          aria-label={alert === undefined ? 'More' : `More: ${alert}`}
        >
          <Indicator disabled={alert === undefined} color="yellow" size={8} offset={2}>
            <IconDots size={layout.topbarIconSize} />
          </Indicator>
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown data-testid="topbar-more-menu">
        {before}
        <ThemePicker />
        {after}
      </Menu.Dropdown>
    </Menu>
  );
}
