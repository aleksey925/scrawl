import { ActionIcon, Anchor, Button, Code, List, Popover, Stack, Text } from '@mantine/core';
import { IconCloudOff } from '@tabler/icons-react';
import { useState, type JSX } from 'react';
import { Link } from 'react-router';

import { documentUrl } from '../paths';

import { useNav } from './NavContext';
import { ResetAction } from './ResetDialog';
import { layout, layoutBreakpoints, useAtLeast } from '../theme';

// thisNote is what the control says when the note on screen is one of the
// affected ones
const thisNote = 'This note has not reached the remote';

export interface SyncSummary {
  here: boolean;
  label: string;
}

// useSyncSummary is undefined while everything is fine, so a control built on
// it renders nothing at all until something is wrong
export function useSyncSummary(): SyncSummary | undefined {
  const { sync, isUnsynced, currentPath } = useNav();
  if (sync === undefined) {
    return undefined;
  }
  const here = isUnsynced(currentPath);
  return { here, label: here ? thisNote : sync.title };
}

function SyncDetails({ onLeave }: { onLeave: () => void }): JSX.Element | null {
  const { sync, me } = useNav();
  const summary = useSyncSummary();
  if (sync === undefined || summary === undefined) {
    return null;
  }
  const paths = me?.space.unsynced.paths ?? [];

  return (
    <Stack data-testid="sync-details" gap="xs">
      <Text size="sm" fw={500}>
        {sync.title}
      </Text>
      {summary.here && (
        <Text data-testid="sync-popover-here" size="sm">
          {thisNote}.
        </Text>
      )}
      {sync.facts.map((fact) => (
        <Stack key={fact.kind} gap={4}>
          <Text size="sm">{fact.body}</Text>
          {fact.reason !== '' && (
            <Code block style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {fact.reason}
            </Code>
          )}
        </Stack>
      ))}
      <ResetAction onOpen={onLeave} />
      {paths.length > 0 && (
        <List data-testid="sync-popover-paths" size="sm" spacing={4} withPadding>
          {paths.map((path) => (
            <List.Item key={path} style={{ overflowWrap: 'anywhere' }}>
              <Anchor component={Link} to={documentUrl(path)} size="sm" onClick={onLeave}>
                {path}
              </Anchor>
            </List.Item>
          ))}
        </List>
      )}
    </Stack>
  );
}

// SyncControl is the one persistent surface that survives scrolling: the banner
// lives inside AppShell.Main, which scrolls away on a long note, and the header
// does not. They share their words and do different jobs.
export function SyncControl(): JSX.Element | null {
  const summary = useSyncSummary();
  const [opened, setOpened] = useState(false);
  const wide = useAtLeast(layoutBreakpoints.compactTopbar);

  if (summary === undefined) {
    return null;
  }

  return (
    <Popover position="bottom-end" width={320} withinPortal opened={opened} onChange={setOpened}>
      <Popover.Target>
        {wide ? (
          <Button
            data-testid="sync-control"
            data-here={summary.here ? 'true' : 'false'}
            variant="subtle"
            color="orange"
            px="xs"
            aria-label={summary.label}
            leftSection={<IconCloudOff size={layout.iconSizeSmall} />}
            style={{ color: 'var(--scrawl-color-orange)' }}
            onClick={() => setOpened((open) => !open)}
          >
            Not synced
          </Button>
        ) : (
          <ActionIcon
            data-testid="sync-control"
            data-here={summary.here ? 'true' : 'false'}
            variant="subtle"
            size="lg"
            aria-label={summary.label}
            style={{ color: 'var(--scrawl-color-orange)' }}
            onClick={() => setOpened((open) => !open)}
          >
            <IconCloudOff size={layout.iconSize} />
          </ActionIcon>
        )}
      </Popover.Target>

      <Popover.Dropdown data-testid="sync-popover">
        <SyncDetails onLeave={() => setOpened(false)} />
      </Popover.Dropdown>
    </Popover>
  );
}
