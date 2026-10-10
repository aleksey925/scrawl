import { Menu, Text, useMantineColorScheme, type MantineColorScheme } from '@mantine/core';
import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';
import type { JSX } from 'react';

import { nextColorScheme } from '../colorScheme';

function SchemeIcon({ scheme, size }: { scheme: MantineColorScheme; size: number }): JSX.Element {
  if (scheme === 'light') {
    return <IconSun size={size} />;
  }
  if (scheme === 'dark') {
    return <IconMoon size={size} />;
  }
  return <IconDeviceDesktop size={size} />;
}

// ThemeItem is the theme entry of a menu. It keeps the menu open, so the
// schemes can be stepped through without opening it again for each one
export function ThemeItem(): JSX.Element {
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  return (
    <Menu.Item
      data-testid="topbar-theme"
      data-scheme={colorScheme}
      closeMenuOnClick={false}
      leftSection={<SchemeIcon scheme={colorScheme} size={16} />}
      rightSection={
        <Text size="xs" c="dimmed">
          {colorScheme}
        </Text>
      }
      onClick={() => setColorScheme(nextColorScheme(colorScheme))}
    >
      Theme
    </Menu.Item>
  );
}
