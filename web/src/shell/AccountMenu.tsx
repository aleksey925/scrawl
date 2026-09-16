import { ActionIcon, Menu, Text } from '@mantine/core';
import { IconEyeOff, IconLogin, IconLogout, IconUserCircle } from '@tabler/icons-react';
import type { JSX } from 'react';

import { api } from '../api/client';
import { goToLogin } from '../login';

import { useNav } from './NavContext';

const iconSize = 18;

export function AccountMenu(): JSX.Element {
  const { me } = useNav();

  const signedIn = me !== undefined && me.user !== '';

  async function signOut(): Promise<void> {
    await api.logout();
    goToLogin();
  }

  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          data-testid="topbar-account"
          data-signed-in={signedIn ? 'true' : 'false'}
          variant="subtle"
          color="gray"
          size="lg"
          aria-label="Account"
        >
          <IconUserCircle size={iconSize} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown data-testid="topbar-account-menu">
        {signedIn && (
          <Menu.Label>
            <Text data-testid="topbar-account-user" size="xs">
              {me.user}
            </Text>
          </Menu.Label>
        )}
        {me?.read_only === true && (
          <Menu.Item data-testid="topbar-account-readonly" disabled leftSection={<IconEyeOff size={16} />}>
            Read-only mode
          </Menu.Item>
        )}
        {signedIn ? (
          <Menu.Item
            data-testid="topbar-account-signout"
            leftSection={<IconLogout size={16} />}
            onClick={() => void signOut()}
          >
            Sign out
          </Menu.Item>
        ) : (
          <Menu.Item
            data-testid="topbar-account-signin"
            leftSection={<IconLogin size={16} />}
            onClick={goToLogin}
          >
            Sign in
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
