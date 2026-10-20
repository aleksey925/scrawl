import { Badge, Menu, Text } from '@mantine/core';
import { IconCheck, IconEyeOff, IconKeyboard, IconLogin, IconLogout } from '../icons';
import type { JSX } from 'react';

import { api } from '../api/client';
import { useApi } from '../api/useApi';
import { PopupMenu } from '../components/PopupMenu';
import { goToLogin } from '../login';
import { layout } from '../theme';

import { useNav } from './NavContext';
import { useReaderLayout } from './ReaderLayout';
import { useKeyboardPlace } from './shortcuts';
import { SpaceButton } from './SpaceButton';
import { SpaceTile } from './SpaceTile';
import { ThemePicker } from './ThemePicker';

async function signOut(): Promise<void> {
  await api.logout();
  goToLogin();
}

// SpaceMenu is everything about the space and the reader, in the head of the
// sidebar: the spaces to switch to, the theme, the account and the keys. A
// switch is a full page load, which boots the shell again under the space's
// own basename.
export function SpaceMenu(): JSX.Element {
  const { me } = useNav();
  const { openShortcuts } = useReaderLayout();
  const keyboard = useKeyboardPlace();
  const state = useApi((signal) => api.spaces({ signal }), []);
  const spaces = state.data ?? [];
  const current = me?.space;
  const signedIn = me !== undefined && me.user !== '';
  const name = current?.label ?? me?.site_title ?? 'Notes';

  return (
    <PopupMenu position="bottom-start" width={280} withinPortal>
      <Menu.Target>
        <SpaceButton name={name} aria-label={`${name}: spaces, theme and account`} />
      </Menu.Target>
      <Menu.Dropdown data-testid="space-menu-dropdown">
        {spaces.length > 0 && (
          <>
            <Menu.Label>Spaces</Menu.Label>
            {spaces.map((entry) => (
              <Menu.Item
                key={entry.name}
                data-testid="space-menu-space-item"
                data-space={entry.name}
                data-current={entry.name === current?.name ? 'true' : 'false'}
                component="a"
                href={entry.url}
                leftSection={<SpaceTile name={entry.label} small />}
                rightSection={
                  entry.name === current?.name ? (
                    <IconCheck size={layout.iconSizeSmall} />
                  ) : entry.read_only ? (
                    <Badge size="xs" variant="light" color="gray">
                      read-only
                    </Badge>
                  ) : undefined
                }
              >
                <Text size="sm" truncate>
                  {entry.label}
                </Text>
              </Menu.Item>
            ))}
            <Menu.Divider />
          </>
        )}

        <ThemePicker />
        <Menu.Divider />

        {signedIn && (
          <Menu.Label>
            <Text data-testid="space-menu-user" size="xs" truncate>
              {me.user}
            </Text>
          </Menu.Label>
        )}
        {me?.read_only === true && (
          <Menu.Item
            data-testid="space-menu-readonly"
            disabled
            leftSection={<IconEyeOff size={layout.iconSizeSmall} />}
          >
            Read-only mode
          </Menu.Item>
        )}
        {keyboard && (
          <Menu.Item
            data-testid="space-menu-shortcuts"
            leftSection={<IconKeyboard size={layout.iconSizeSmall} />}
            rightSection={<Text size="xs" c="dimmed">?</Text>}
            onClick={openShortcuts}
          >
            Keyboard shortcuts
          </Menu.Item>
        )}
        {signedIn ? (
          <Menu.Item
            data-testid="space-menu-signout"
            leftSection={<IconLogout size={layout.iconSizeSmall} />}
            rightSection={
              <Text size="xs" c="dimmed" truncate maw={120}>
                {me.user}
              </Text>
            }
            onClick={() => void signOut()}
          >
            Sign out
          </Menu.Item>
        ) : (
          <Menu.Item
            data-testid="space-menu-signin"
            leftSection={<IconLogin size={layout.iconSizeSmall} />}
            onClick={goToLogin}
          >
            Sign in
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </PopupMenu>
  );
}
