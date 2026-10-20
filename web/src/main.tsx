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
import { applyStoredPageWidth } from './shell/pageWidth';
import { applyStoredTheme } from './themeChoice';

applyStoredTheme();
applyStoredPageWidth();
enablePressFeedback();
printInLight();

createRoot(mountNode()).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
