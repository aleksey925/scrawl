import { useMantineColorScheme } from '@mantine/core';
import { useEffect } from 'react';

import { restorePageWidth } from '../shell/pageWidth';
import { useReaderLayout } from '../shell/ReaderLayout';
import { restoreThemeChoice } from '../themeChoice';

export function PageRestore(): null {
  const { setColorScheme } = useMantineColorScheme();
  const { closePanels } = useReaderLayout();

  useEffect(() => {
    const onShow = (event: PageTransitionEvent): void => {
      if (event.persisted) {
        restoreThemeChoice(setColorScheme);
        restorePageWidth();
        closePanels();
      }
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [setColorScheme, closePanels]);

  return null;
}
