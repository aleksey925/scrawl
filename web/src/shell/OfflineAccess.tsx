import { Menu, Switch, Text } from '@mantine/core';
import { useEffect, type JSX } from 'react';

import { IconCloudDown } from '../icons';
import { useConnected } from '../offline/connection';
import { offlineSupported, useOfflineWanted } from '../offline/preference';
import { turnOfflineOff, turnOfflineOn } from '../offline/register';
import { refreshStatus, statusLine, useOfflineStatus } from '../offline/status';
import { layout } from '../theme';
import { showToast } from '../toast';

import classes from './OfflineAccess.module.css';

export function OfflineAccessItem(): JSX.Element {
  const supported = offlineSupported();
  const wanted = useOfflineWanted();
  const online = useConnected();
  const status = useOfflineStatus();
  const line = statusLine({ supported, wanted, online, status });

  const toggle = (): void => {
    (wanted ? turnOfflineOff() : turnOfflineOn()).catch(() => {
      showToast('error', { message: wanted ? 'Could not turn offline access off' : 'Could not turn offline access on' });
    });
  };

  useEffect(() => {
    if (supported && wanted) {
      void refreshStatus();
    }
  }, [supported, wanted]);

  return (
    <Menu.Item
      data-testid="space-menu-offline"
      data-on={wanted ? 'true' : 'false'}
      role="menuitemcheckbox"
      aria-checked={wanted}
      disabled={!supported}
      closeMenuOnClick={false}
      leftSection={<IconCloudDown size={layout.iconSizeSmall} />}
      rightSection={
        <Switch size="xs" checked={wanted} readOnly tabIndex={-1} aria-hidden style={{ pointerEvents: 'none' }} />
      }
      onClick={toggle}
    >
      <Text size="sm">Offline access</Text>
      {line !== undefined && (
        <Text data-testid="space-menu-offline-status" className={classes.status} inherit>
          {line}
        </Text>
      )}
    </Menu.Item>
  );
}
