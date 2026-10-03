import { Anchor, Button, Code, Drawer, List, Popover, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useState, type JSX } from 'react';
import { Link } from 'react-router';

import { documentUrl, isMarkdown, rawUrl } from '../paths';

import { useNav } from './NavContext';
import { ResetAction } from './ResetDialog';

// thisNote is what the control says when the note on screen is one of the
// affected ones. It asks about the file and never about the route, which is the
// whole point: on the home screen the route path is "" while the note is
// index.md, and that is the page most readers are looking at.
const thisNote = 'This note has not reached the remote';

export interface SyncSummary {
  here: boolean;
  label: string;
}

// useSyncSummary is undefined while everything is fine, so a control built on
// it renders nothing at all until something is wrong
export function useSyncSummary(): SyncSummary | undefined {
  const { sync, isUnsynced, currentDoc } = useNav();
  if (sync === undefined) {
    return undefined;
  }
  const here = isUnsynced(currentDoc);
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
              {/* /raw/ is a server route with no shell, so a router link
                  there would change the address bar and never reach it */}
              {isMarkdown(path) ? (
                <Anchor component={Link} to={documentUrl(path)} size="sm" onClick={onLeave}>
                  {path}
                </Anchor>
              ) : (
                <Anchor href={rawUrl(path)} size="sm">
                  {path}
                </Anchor>
              )}
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

  if (summary === undefined) {
    return null;
  }

  return (
    <Popover position="bottom-end" width={320} withinPortal opened={opened} onChange={setOpened}>
      <Popover.Target>
        <Button
          data-testid="sync-control"
          data-here={summary.here ? 'true' : 'false'}
          variant="subtle"
          color="yellow"
          size="xs"
          px="xs"
          aria-label={summary.label}
          leftSection={<IconAlertTriangle size={16} />}
          onClick={() => setOpened((open) => !open)}
        >
          Not synced
        </Button>
      </Popover.Target>

      <Popover.Dropdown data-testid="sync-popover">
        <SyncDetails onLeave={() => setOpened(false)} />
      </Popover.Dropdown>
    </Popover>
  );
}

// SyncSheet carries the same details on a phone, where the control is an entry
// in the topbar menu and a popover would hang off a menu that is already gone
export function SyncSheet({ opened, onClose }: { opened: boolean; onClose: () => void }): JSX.Element {
  return (
    <Drawer data-testid="sync-sheet" opened={opened} onClose={onClose} position="bottom" size="60%" title="Not synced" padding="md">
      <SyncDetails onLeave={onClose} />
    </Drawer>
  );
}
