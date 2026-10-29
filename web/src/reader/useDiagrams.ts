import { useComputedColorScheme } from '@mantine/core';
import { useEffect, useMemo, type RefObject } from 'react';

import { usePlatform } from '../platform';
import { useThemeChoice } from '../themeChoice';
import { drawDiagrams, type DiagramLoaders } from './diagrams';

export function useDiagrams(rootRef: RefObject<HTMLDivElement | null>, html: string): void {
  const colorScheme = useComputedColorScheme('light');
  const choice = useThemeChoice();
  const { loadMermaid, loadPlantUML } = usePlatform();
  const loaders = useMemo<DiagramLoaders>(
    () => ({ mermaid: loadMermaid, plantUML: loadPlantUML }),
    [loadMermaid, loadPlantUML],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return undefined;
    }
    return drawDiagrams(root, loaders, colorScheme === 'dark');
  }, [rootRef, html, colorScheme, choice, loaders]);
}
