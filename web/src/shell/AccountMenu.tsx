import { ActionIcon, Menu, Text } from '@mantine/core';
import { IconEyeOff, IconLogin, IconLogout, IconUserCircle } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../api/client';

import { useNav } from './NavContext';

const iconSize = 18;

export function AccountMenu(): JSX.Element {
  const navigate = useNavigate();
  const { me } = useNav();

  const signedIn = me !== undefined && me.user !== '';

  async function signOut(): Promise<void> {
    await api.logout();
    await navigate('/login');
  }

  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Account">
          <IconUserCircle size={iconSize} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {signedIn && (
          <Menu.Label>
            <Text size="xs">{me.user}</Text>
          </Menu.Label>
        )}
        {me?.read_only === true && (
          <Menu.Item disabled leftSection={<IconEyeOff size={16} />}>
            Read-only mode
          </Menu.Item>
        )}
        {signedIn ? (
          <Menu.Item leftSection={<IconLogout size={16} />} onClick={() => void signOut()}>
            Sign out
          </Menu.Item>
        ) : (
          <Menu.Item leftSection={<IconLogin size={16} />} onClick={() => void navigate('/login')}>
            Sign in
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
