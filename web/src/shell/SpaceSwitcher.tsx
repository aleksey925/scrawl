import { Button, Menu, Text } from '@mantine/core';
import { IconCheck, IconChevronDown, IconEyeOff } from '@tabler/icons-react';
import type { JSX } from 'react';

import { api } from '../api/client';
import { useApi } from '../api/useApi';
import { layout } from '../theme';

import { useNav } from './NavContext';

// SpaceSwitcher goes to another space's root with a full page load, which
// re-boots the shell with the new basename. There is no client-side
// multi-space state to hold, which is the point of one subtree per space.
export function SpaceSwitcher(): JSX.Element | null {
  const { me } = useNav();
  const state = useApi((signal) => api.spaces({ signal }), []);

  const spaces = state.data ?? [];
  const current = me?.space;
  // with one space there is nothing to switch to, so the control is not there
  if (spaces.length < 2 || current === undefined) {
    return null;
  }

  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        {/* no visibleFrom: a phone is where a reader is most likely to have
            landed in the wrong space, and the theme gives every Button the
            touch minimum on a coarse pointer already. The label truncates
            instead, so the controls beside it keep their room. */}
        <Button
          data-testid="topbar-space"
          variant="subtle"
          color="gray"
          size="sm"
          px="xs"
          maw={layout.spaceSwitcherWidth}
          miw={layout.tapTarget}
          style={{ flexShrink: 1 }}
          rightSection={<IconChevronDown size={14} />}
          styles={{ label: { overflow: 'hidden', textOverflow: 'ellipsis' } }}
        >
          {current.label}
        </Button>
      </Menu.Target>
      <Menu.Dropdown data-testid="topbar-space-menu">
        <Menu.Label>Spaces</Menu.Label>
        {spaces.map((entry) => (
          <Menu.Item
            key={entry.name}
            data-testid="topbar-space-item"
            data-space={entry.name}
            data-current={entry.name === current.name ? 'true' : 'false'}
            component="a"
            href={entry.url}
            leftSection={
              entry.name === current.name ? <IconCheck size={16} /> : <span style={{ width: 16 }} />
            }
            rightSection={entry.read_only ? <IconEyeOff size={14} /> : undefined}
          >
            <Text size="sm">{entry.label}</Text>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
