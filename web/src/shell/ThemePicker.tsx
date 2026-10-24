import { Group, Menu, SegmentedControl, useMantineColorScheme } from '@mantine/core';
import type { JSX } from 'react';

import controls from '../controls.module.css';
import { IconDeviceDesktop, IconMoon, IconSun } from '../icons';
import { setThemeChoice, useThemeChoice } from '../themeChoice';
import { autoChoice, isThemeChoice, themes } from '../themes';
import { layout } from '../theme';

const options = [
  { value: autoChoice, icon: IconDeviceDesktop, label: 'Auto' },
  ...themes.map((entry) => ({ value: entry.id, icon: entry.scheme === 'dark' ? IconMoon : IconSun, label: entry.name })),
];

export function ThemePicker(): JSX.Element {
  const { setColorScheme } = useMantineColorScheme();
  const choice = useThemeChoice();

  return (
    <>
      <Menu.Label>Theme</Menu.Label>
      <div className={controls.menuControl}>
        <SegmentedControl
          data-testid="space-menu-theme"
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
                <Icon size={layout.iconSizeSmall} />
                <span>{label}</span>
              </Group>
            ),
          }))}
        />
      </div>
    </>
  );
}
