import { useMantineColorScheme } from '@mantine/core';
import { useEffect } from 'react';

import { restorePageWidth } from '../shell/pageWidth';
import { useReaderLayout } from '../shell/ReaderLayout';
import { restoreThemeChoice } from '../themeChoice';

// PageRestore answers Back: the browser brings a page of a site back as it was
// left, with the theme and the page width it had then and the sheet a link in
// it was tapped in
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
