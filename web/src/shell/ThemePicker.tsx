import { Group, Menu, SegmentedControl, useMantineColorScheme } from '@mantine/core';
import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';
import type { JSX } from 'react';

import { isColorScheme } from '../colorScheme';
import controls from '../controls.module.css';

const schemeOptions = [
  { value: 'auto', icon: IconDeviceDesktop, label: 'Auto' },
  { value: 'light', icon: IconSun, label: 'Light' },
  { value: 'dark', icon: IconMoon, label: 'Dark' },
] as const;

// ThemePicker is the theme row of a menu: every scheme is one press away, where
// a single item had to be pressed through the others to reach the one wanted
export function ThemePicker(): JSX.Element {
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  return (
    <>
      <Menu.Label>Theme</Menu.Label>
      <div className={controls.menuControl}>
        <SegmentedControl
          data-testid="topbar-theme"
          data-scheme={colorScheme}
          fullWidth
          size="sm"
          classNames={{ label: controls.menuSegment }}
          value={colorScheme}
          onChange={(value) => {
            if (isColorScheme(value)) {
              setColorScheme(value);
            }
          }}
          aria-label="Theme"
          data={schemeOptions.map(({ value, icon: Icon, label }) => ({
            value,
            label: (
              <Group gap={6} wrap="nowrap" justify="center">
                <Icon size={16} />
                <span>{label}</span>
              </Group>
            ),
          }))}
        />
      </div>
    </>
  );
}
