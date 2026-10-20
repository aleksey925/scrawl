import { Menu } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useState, type JSX } from 'react';

import { AccountItems } from './AccountMenu';
import { MoreMenu } from './MoreMenu';
import { SyncSheet, useSyncSummary } from './SyncControl';

// AppMoreMenu is the phone's menu with the sync state above the theme and the
// account below it
export function AppMoreMenu(): JSX.Element {
  const sync = useSyncSummary();
  const [syncOpened, setSyncOpened] = useState(false);

  return (
    <>
      <MoreMenu
        alert={sync?.label}
        before={
          sync !== undefined && (
            <Menu.Item
              data-testid="sync-control"
              data-here={sync.here ? 'true' : 'false'}
              color="yellow"
              leftSection={<IconAlertTriangle size={16} />}
              onClick={() => setSyncOpened(true)}
            >
              {sync.label}
            </Menu.Item>
          )
        }
        after={
          <>
            <Menu.Divider />
            <AccountItems />
          </>
        }
      />
      <SyncSheet opened={syncOpened} onClose={() => setSyncOpened(false)} />
    </>
  );
}
