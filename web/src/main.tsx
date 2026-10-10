import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { applyStoredColorScheme } from './colorScheme';
import { mountNode } from './mount';
import { installStyleNonce } from './nonce';

applyStoredColorScheme();
installStyleNonce();

createRoot(mountNode()).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
