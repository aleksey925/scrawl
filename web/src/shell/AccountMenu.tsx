import { ActionIcon, Menu, Text } from '@mantine/core';
import { IconLogin, IconLogout, IconUserCircle } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../api/client';
import { useApi } from '../api/useApi';

const iconSize = 18;

export function AccountMenu(): JSX.Element {
  const navigate = useNavigate();
  const me = useApi((signal) => api.me({ signal }), []);

  const signedIn = me.data !== undefined && me.data.user !== '';

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
            <Text size="xs">{me.data?.user}</Text>
          </Menu.Label>
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
