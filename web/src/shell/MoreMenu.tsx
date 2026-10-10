import { ActionIcon, Indicator, Menu } from '@mantine/core';
import { IconAlertTriangle, IconDots } from '@tabler/icons-react';
import { useState, type JSX } from 'react';

import { layout } from '../theme';

import { AccountItems } from './AccountMenu';
import { SyncSheet, useSyncSummary } from './SyncControl';
import { ThemeItem } from './ThemeItem';

// MoreMenu holds on a phone what the desktop topbar keeps in two places: the
// sync state, and the theme with the account. The dot on it is what survives
// scrolling while the sync is broken, the banner having scrolled away.
export function MoreMenu(): JSX.Element {
  const sync = useSyncSummary();
  const [syncOpened, setSyncOpened] = useState(false);

  return (
    <>
      <Menu position="bottom-end" width={240} withinPortal>
        <Menu.Target>
          <ActionIcon
            data-testid="topbar-more"
            data-sync={sync === undefined ? 'false' : 'true'}
            variant="subtle"
            color="gray"
            size="lg"
            aria-label={sync === undefined ? 'More' : `More: ${sync.label}`}
          >
            <Indicator disabled={sync === undefined} color="yellow" size={8} offset={2}>
              <IconDots size={layout.topbarIconSize} />
            </Indicator>
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown data-testid="topbar-more-menu">
          {sync !== undefined && (
            <Menu.Item
              data-testid="sync-control"
              data-here={sync.here ? 'true' : 'false'}
              color="yellow"
              leftSection={<IconAlertTriangle size={16} />}
              onClick={() => setSyncOpened(true)}
            >
              {sync.label}
            </Menu.Item>
          )}
          <ThemeItem />
          <Menu.Divider />
          <AccountItems />
        </Menu.Dropdown>
      </Menu>
      <SyncSheet opened={syncOpened} onClose={() => setSyncOpened(false)} />
    </>
  );
}
