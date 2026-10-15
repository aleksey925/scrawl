import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';
// after mantine's own sheet, whose defaults it replaces at equal specificity
import 'virtual:theme-stylesheet.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { mountNode } from './mount';
import { applyStoredTheme } from './themeChoice';

applyStoredTheme();

createRoot(mountNode()).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
