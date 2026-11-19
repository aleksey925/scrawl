import { Menu, useMantineColorScheme } from '@mantine/core';
import type { JSX } from 'react';

import { Segmented, type SegmentedOption } from '../components/Segmented';
import controls from '../controls.module.css';
import { IconDeviceDesktop, IconMoon, IconSun } from '../icons';
import { setThemeChoice, useThemeChoice } from '../themeChoice';
import { autoChoice, themes } from '../themes';

export const themeOptions: SegmentedOption<string>[] = [
  { value: autoChoice, icon: IconDeviceDesktop, label: 'Auto' },
  ...themes.map((entry) => ({ value: entry.id, icon: entry.scheme === 'dark' ? IconMoon : IconSun, label: entry.name })),
];

export interface ThemeState {
  choice: string;
  choose: (value: string) => void;
}

export function useTheme(): ThemeState {
  const { setColorScheme } = useMantineColorScheme();
  const choice = useThemeChoice();
  return { choice, choose: (value) => setThemeChoice(value, setColorScheme) };
}

export function ThemePicker(): JSX.Element {
  const { choice, choose } = useTheme();

  return (
    <>
      <Menu.Label>Theme</Menu.Label>
      <div className={controls.menuControl}>
        <Segmented
          data-testid="space-menu-theme"
          data-theme={choice}
          fullWidth
          size="sm"
          classNames={{ label: controls.menuSegment }}
          value={choice}
          onChange={choose}
          aria-label="Theme"
          options={themeOptions}
        />
      </div>
    </>
  );
}
