import { ActionIcon, Button, Popover } from '@mantine/core';
import { useState, type JSX } from 'react';

import { TapGuard, useTouchScreen } from '../components/TapGuard';
import { IconWifiOff } from '../icons';
import { useConnection } from '../offline/connection';
import { copyTime, useOfflineStatus } from '../offline/status';
import { layout, layoutBreakpoints, useAtLeast } from '../theme';

import { StatusTip, statusTipTarget } from './StatusTip';

export function OfflineMark(): JSX.Element | null {
  const offline = useConnection() === 'offline';
  const { state } = useOfflineStatus();
  const [opened, setOpened] = useState(false);
  const touch = useTouchScreen();
  const wide = useAtLeast(layoutBreakpoints.compactTopbar);

  if (!offline) {
    return null;
  }
  const updatedAt = state?.updatedAt ?? 0;
  const shared = {
    'data-testid': 'offline-mark',
    'aria-label': 'Offline',
    className: statusTipTarget,
    style: { color: 'var(--scrawl-text-secondary)' },
    onClick: () => setOpened((open) => !open),
  };

  return (
    <>
      <Popover
        position="bottom"
        withinPortal
        floatingStrategy="fixed"
        opened={opened}
        onChange={setOpened}
        closeOnClickOutside={!touch}
      >
        <Popover.Target>
          {wide ? (
            <Button {...shared} variant="subtle" color="gray" px="xs" leftSection={<IconWifiOff size={layout.iconSizeSmall} aria-hidden />}>
              Offline
            </Button>
          ) : (
            <ActionIcon {...shared} variant="subtle" color="gray" size="lg">
              <IconWifiOff size={layout.iconSize} aria-hidden />
            </ActionIcon>
          )}
        </Popover.Target>
        <StatusTip
          testId="offline-popover"
          title="No network"
          line={updatedAt > 0 ? `Last sync ${copyTime(updatedAt)}` : undefined}
        />
      </Popover>
      <TapGuard active={opened} onClose={() => setOpened(false)} />
    </>
  );
}
