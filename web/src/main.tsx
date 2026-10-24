import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
// after mantine's own sheet, whose defaults it replaces at equal specificity
import 'virtual:theme-stylesheet.css';
import './global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { mountNode } from './mount';
import { printInLight } from './print';
import { enablePressFeedback } from './pressFeedback';
import { router } from './routes';
import { applyStoredPageWidth } from './shell/pageWidth';
import { reloadOnStaleBundle } from './staleBundle';
import { applyStoredTheme } from './themeChoice';

reloadOnStaleBundle(() => {
  const target = router.state.navigation.location;
  return target === undefined ? undefined : router.createHref(target);
});
applyStoredTheme();
applyStoredPageWidth();
enablePressFeedback();
printInLight();

createRoot(mountNode()).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
