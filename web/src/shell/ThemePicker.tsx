import { Group, Menu, SegmentedControl, useMantineColorScheme } from '@mantine/core';
import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';
import type { JSX } from 'react';

import controls from '../controls.module.css';
import { setThemeChoice, useThemeChoice } from '../themeChoice';
import { autoChoice, isThemeChoice, themes } from '../themes';

const options = [
  { value: autoChoice, icon: IconDeviceDesktop, label: 'Auto' },
  ...themes.map((entry) => ({ value: entry.id, icon: entry.scheme === 'dark' ? IconMoon : IconSun, label: entry.name })),
];

// ThemePicker is the theme row of a menu: every theme is one press away, where
// a single item had to be pressed through the others to reach the one wanted
export function ThemePicker(): JSX.Element {
  const { setColorScheme } = useMantineColorScheme();
  const choice = useThemeChoice();

  return (
    <>
      <Menu.Label>Theme</Menu.Label>
      <div className={controls.menuControl}>
        <SegmentedControl
          data-testid="topbar-theme"
          data-theme={choice}
          fullWidth
          size="sm"
          classNames={{ label: controls.menuSegment }}
          value={choice}
          onChange={(value) => {
            if (isThemeChoice(value)) {
              setThemeChoice(value, setColorScheme);
            }
          }}
          aria-label="Theme"
          data={options.map(({ value, icon: Icon, label }) => ({
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
