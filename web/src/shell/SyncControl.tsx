import { Anchor, Box, Button, Code, List, Popover, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useState, type JSX } from 'react';
import { Link } from 'react-router';

import { documentUrl, isMarkdown, rawUrl } from '../paths';
import { layoutBreakpoints } from '../theme';

import { useNav } from './NavContext';

// thisNote is what the control says when the note on screen is one of the
// affected ones. It asks about the file and never about the route, which is the
// whole point: on the home screen the route path is "" while the note is
// index.md, and that is the page most readers are looking at.
const thisNote = 'This note has not reached the remote';

// SyncControl is the one persistent surface that survives scrolling: the banner
// lives inside AppShell.Main, which scrolls away on a long note, and the header
// does not. They share their words and do different jobs.
//
// When everything is fine it renders nothing at all - no placeholder, no grey
// icon - so the topbar has one fewer control than it does today until something
// is wrong.
export function SyncControl(): JSX.Element | null {
  const { sync, isUnsynced, currentDoc, me } = useNav();
  const [opened, setOpened] = useState(false);

  if (sync === undefined) {
    return null;
  }
  const here = isUnsynced(currentDoc);
  const label = here ? thisNote : sync.title;
  const paths = me?.project.unsynced.paths ?? [];

  return (
    <Popover position="bottom-end" width={320} withinPortal opened={opened} onChange={setOpened}>
      <Popover.Target>
        {/* one element, not the search button's pair: a Popover takes exactly
            one target, so the label is what hides on a narrow screen and never
            the control */}
        <Button
          data-testid="sync-control"
          data-here={here ? 'true' : 'false'}
          variant="subtle"
          color="yellow"
          size="xs"
          px="xs"
          aria-label={label}
          leftSection={<IconAlertTriangle size={16} />}
          onClick={() => setOpened((open) => !open)}
        >
          <Box component="span" visibleFrom={layoutBreakpoints.compactTopbar}>
            Not synced
          </Box>
        </Button>
      </Popover.Target>

      <Popover.Dropdown data-testid="sync-popover">
        <Stack gap="xs">
          <Text size="sm" fw={500}>
            {sync.title}
          </Text>
          {here && (
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
          {paths.length > 0 && (
            <List data-testid="sync-popover-paths" size="sm" spacing={4} withPadding>
              {paths.map((path) => (
                <List.Item key={path} style={{ overflowWrap: 'anywhere' }}>
                  {/* /raw/ is a server route with no shell, so a router link
                      there would change the address bar and never reach it */}
                  {isMarkdown(path) ? (
                    <Anchor component={Link} to={documentUrl(path)} size="sm" onClick={() => setOpened(false)}>
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
      </Popover.Dropdown>
    </Popover>
  );
}
