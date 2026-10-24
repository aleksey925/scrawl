import type { MantineColorScheme, MantineColorSchemeManager } from '@mantine/core';
import { useSyncExternalStore } from 'react';

import { changeSignal } from './changeSignal';
import { syncHead } from './headTheme';
import { serverPersistence, type ThemePersistence } from './themePersistence';
import { applyChoiceAttributes, applyThemeAttribute, autoChoice, colorSchemeAttribute, lookupTheme } from './themes';

let persistence = serverPersistence();
let current: string | undefined;

export function keepThemeIn(where: ThemePersistence): void {
  persistence = where;
  current = undefined;
}

function choice(): string {
  current ??= persistence.read() ?? autoChoice;
  return current;
}

function schemeOf(picked: string): MantineColorScheme {
  return lookupTheme(picked)?.scheme ?? autoChoice;
}

export function themeColorSchemeManager(): MantineColorSchemeManager {
  return {
    get: (defaultValue) => {
      const picked = persistence.read();
      return picked === undefined ? defaultValue : schemeOf(picked);
    },
    set: () => {},
    subscribe: () => {},
    unsubscribe: () => {},
    clear: () => persistence.clear(),
  };
}

const changes = changeSignal();

export function useThemeChoice(): string {
  return useSyncExternalStore(changes.subscribe, choice);
}

function show(picked: string, setColorScheme: (value: MantineColorScheme) => void): void {
  current = picked;
  applyThemeAttribute(picked);
  syncHead(picked);
  setColorScheme(schemeOf(picked));
  changes.notify();
}

export function setThemeChoice(picked: string, setColorScheme: (value: MantineColorScheme) => void): void {
  persistence.write(picked);
  show(picked, setColorScheme);
}

export function previewThemeChoice(picked: string, setColorScheme: (value: MantineColorScheme) => void): void {
  show(picked, setColorScheme);
}

export function restoreThemeChoice(setColorScheme: (value: MantineColorScheme) => void): void {
  show(persistence.read() ?? autoChoice, setColorScheme);
}

export function applyStoredTheme(): void {
  if (document.documentElement.hasAttribute(colorSchemeAttribute)) {
    return;
  }
  applyChoiceAttributes(choice());
}
