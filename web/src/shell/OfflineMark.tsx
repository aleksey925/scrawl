import { ActionIcon, Button, Popover, Text } from '@mantine/core';
import { useState, type JSX } from 'react';

import { TapGuard, useTouchScreen } from '../components/TapGuard';
import { IconWifiOff } from '../icons';
import { useConnection } from '../offline/connection';
import { copyTime, useOfflineStatus } from '../offline/status';
import { layout, layoutBreakpoints, useAtLeast } from '../theme';

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
  const message = updatedAt > 0
    ? `No network. Notes from ${copyTime(updatedAt)}, nothing can be changed.`
    : 'No network. Nothing can be changed.';
  const shared = {
    'data-testid': 'offline-mark',
    'aria-label': 'Offline',
    style: { color: 'var(--scrawl-text-secondary)' },
    onClick: () => setOpened((open) => !open),
  };

  return (
    <>
      <Popover
        position="bottom-end"
        width={280}
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
        <Popover.Dropdown data-testid="offline-popover">
          <Text size="sm">{message}</Text>
        </Popover.Dropdown>
      </Popover>
      <TapGuard active={opened} onClose={() => setOpened(false)} />
    </>
  );
}
