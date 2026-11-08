import { ActionIcon, Anchor, Button, Code, List, Loader, Popover, Stack, Text } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { useState, type JSX } from 'react';
import { Link } from 'react-router';

import { TapGuard, useTouchScreen } from '../components/TapGuard';
import { IconAlertTriangle, IconCloudCheck, IconCloudOff, IconCloudUp } from '../icons';
import { documentUrl } from '../paths';
import { layout, layoutBreakpoints, useAtLeast } from '../theme';

import { useNav } from './NavContext';
import { ResetAction } from './ResetDialog';
import type { SyncStatus } from './syncMessage';

const thisNote = 'This note has not reached the remote';

const calmText: Partial<Record<SyncStatus['state'], string>> = {
  sending: 'Sending changes to the remote.',
  sent: 'All changes sent. Everything saved here is on the remote too.',
};

interface SyncSummary {
  status: SyncStatus;
  here: boolean;
  label: string;
}

function useSyncSummary(): SyncSummary | undefined {
  const { syncStatus, isUnsynced, currentPath } = useNav();
  if (syncStatus === undefined) {
    return undefined;
  }
  const here = isUnsynced(currentPath);
  return { status: syncStatus, here, label: here ? `${syncStatus.name}. ${thisNote}` : syncStatus.name };
}

function SyncIcon({ state, size }: { state: SyncStatus['state']; size: number }): JSX.Element {
  const reduceMotion = useReducedMotion();
  switch (state) {
    case 'sending':
      return reduceMotion ? (
        <IconCloudUp data-testid="sync-still" size={size} aria-hidden />
      ) : (
        <Loader data-testid="sync-spinner" size={size - 4} color="var(--scrawl-text-secondary)" aria-hidden />
      );
    case 'sent':
      return <IconCloudCheck size={size} aria-hidden />;
    case 'blocked':
      return <IconAlertTriangle size={size} aria-hidden />;
    default:
      return <IconCloudOff size={size} aria-hidden />;
  }
}

function SyncDetails({ summary, onLeave }: { summary: SyncSummary; onLeave: () => void }): JSX.Element {
  const { sync, me } = useNav();
  const { state, name } = summary.status;
  const calm = calmText[state];
  const paths = me?.space.unsynced.paths ?? [];

  return (
    <Stack data-testid="sync-details" gap="xs">
      <Text size="sm" fw={500}>
        {name}
      </Text>
      {calm !== undefined && <Text size="sm">{calm}</Text>}
      {summary.here && (
        <Text data-testid="sync-popover-here" size="sm">
          {thisNote}.
        </Text>
      )}
      {calm === undefined &&
        sync?.facts.map((entry) => (
          <Stack key={entry.kind} gap={4}>
            <Text size="sm">{entry.body}</Text>
            {entry.reason !== '' && (
              <Code block style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {entry.reason}
              </Code>
            )}
          </Stack>
        ))}
      <ResetAction onOpen={onLeave} />
      {paths.length > 0 && (
        <List data-testid="sync-popover-paths" size="sm" spacing={4} withPadding>
          {paths.map((unsynced) => (
            <List.Item key={unsynced} style={{ overflowWrap: 'anywhere' }}>
              <Anchor component={Link} to={documentUrl(unsynced)} size="sm" onClick={onLeave}>
                {unsynced}
              </Anchor>
            </List.Item>
          ))}
        </List>
      )}
    </Stack>
  );
}

export function SyncControl(): JSX.Element | null {
  const summary = useSyncSummary();
  const [opened, setOpened] = useState(false);
  const touch = useTouchScreen();
  const wide = useAtLeast(layoutBreakpoints.compactTopbar);

  if (summary === undefined) {
    return null;
  }
  const { state, name } = summary.status;
  const calm = calmText[state] !== undefined;
  const color = calm ? 'var(--scrawl-text-secondary)' : 'var(--scrawl-color-orange)';
  const shared = {
    'data-testid': 'sync-control',
    'data-here': summary.here ? 'true' : 'false',
    'data-state': state,
    'aria-label': summary.label,
    style: { color },
    onClick: () => setOpened((open) => !open),
  };

  return (
    <>
      <Popover
        position="bottom-end"
        width={320}
        withinPortal
        floatingStrategy="fixed"
        opened={opened}
        onChange={setOpened}
        closeOnClickOutside={!touch}
      >
        <Popover.Target>
          {wide && !calm ? (
            <Button
              {...shared}
              variant="subtle"
              color="orange"
              px="xs"
              leftSection={<SyncIcon state={state} size={layout.iconSizeSmall} />}
            >
              {name}
            </Button>
          ) : (
            <ActionIcon {...shared} variant="subtle" color="gray" size="lg">
              <SyncIcon state={state} size={wide ? layout.iconSizeSmall : layout.iconSize} />
            </ActionIcon>
          )}
        </Popover.Target>

        <Popover.Dropdown data-testid="sync-popover">
          <SyncDetails summary={summary} onLeave={() => setOpened(false)} />
        </Popover.Dropdown>
      </Popover>
      <TapGuard active={opened} onClose={() => setOpened(false)} />
    </>
  );
}
