import { useComputedColorScheme } from '@mantine/core';
import { useLayoutEffect, type RefObject } from 'react';

import { usePlatform } from '../platform';
import { useThemeChoice } from '../themeChoice';
import { drawDiagrams } from './diagrams';

export function useDiagrams(rootRef: RefObject<HTMLDivElement | null>, html: string): void {
  const colorScheme = useComputedColorScheme('light');
  const choice = useThemeChoice();
  const { loadMermaid, loadPlantUML } = usePlatform();

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return undefined;
    }
    return drawDiagrams(root, { loadMermaid, loadPlantUML }, colorScheme === 'dark', choice);
  }, [rootRef, html, colorScheme, choice, loadMermaid, loadPlantUML]);
}
