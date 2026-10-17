import { useComputedColorScheme } from '@mantine/core';
import { useEffect, type RefObject } from 'react';

import { useThemeChoice } from '../themeChoice';
import { drawDiagrams } from './diagrams';

export function useMermaid(rootRef: RefObject<HTMLDivElement | null>, html: string): void {
  const colorScheme = useComputedColorScheme('light');
  // two themes can share a scheme, and the diagram is painted with the tokens
  const choice = useThemeChoice();

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return undefined;
    }
    return drawDiagrams(root, async () => (await import('mermaid')).default, colorScheme === 'dark');
  }, [rootRef, html, colorScheme, choice]);
}
