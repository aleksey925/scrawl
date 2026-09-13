import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { applyStoredColorScheme } from './colorScheme';
import { installStyleNonce } from './nonce';

applyStoredColorScheme();
installStyleNonce();

const mountId = 'scrawl-app-root';
const container = document.getElementById(mountId);
if (container === null) {
  throw new Error(`mount node #${mountId} is missing from the shell`);
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
