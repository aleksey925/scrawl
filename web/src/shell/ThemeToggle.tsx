import { ActionIcon, Tooltip, useMantineColorScheme } from '@mantine/core';
import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';
import type { JSX } from 'react';

import { nextColorScheme } from '../colorScheme';

const iconSize = 18;

export function ThemeToggle(): JSX.Element {
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  const icon =
    colorScheme === 'light' ? (
      <IconSun size={iconSize} />
    ) : colorScheme === 'dark' ? (
      <IconMoon size={iconSize} />
    ) : (
      <IconDeviceDesktop size={iconSize} />
    );

  return (
    <Tooltip label={`Theme: ${colorScheme}`}>
      <ActionIcon
        variant="subtle"
        color="gray"
        size="lg"
        aria-label={`Theme: ${colorScheme}, switch to ${nextColorScheme(colorScheme)}`}
        onClick={() => setColorScheme(nextColorScheme(colorScheme))}
      >
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}
