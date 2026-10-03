import { ActionIcon, Tooltip, useMantineColorScheme, type MantineColorScheme } from '@mantine/core';
import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';
import type { JSX } from 'react';

import { nextColorScheme } from '../colorScheme';
import { layout } from '../theme';

export function SchemeIcon({ scheme, size }: { scheme: MantineColorScheme; size: number }): JSX.Element {
  if (scheme === 'light') {
    return <IconSun size={size} />;
  }
  if (scheme === 'dark') {
    return <IconMoon size={size} />;
  }
  return <IconDeviceDesktop size={size} />;
}

export function ThemeToggle(): JSX.Element {
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  return (
    <Tooltip label={`Theme: ${colorScheme}`}>
      <ActionIcon
        data-testid="topbar-theme"
        data-scheme={colorScheme}
        variant="subtle"
        color="gray"
        size="lg"
        aria-label={`Theme: ${colorScheme}, switch to ${nextColorScheme(colorScheme)}`}
        onClick={() => setColorScheme(nextColorScheme(colorScheme))}
      >
        <SchemeIcon scheme={colorScheme} size={layout.topbarIconSize} />
      </ActionIcon>
    </Tooltip>
  );
}
