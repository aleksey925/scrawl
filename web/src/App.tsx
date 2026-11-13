import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import type { JSX } from 'react';
import { RouterProvider } from 'react-router';

import { appPlatform, offlinePlatform, startingPlatform } from './appPlatform';
import { Toasts } from './components/Toasts';
import { useConnection, type Connection } from './offline/connection';
import { PlatformProvider, type Platform } from './platform';
import { router } from './routes';
import { theme } from './theme';
import { themeColorSchemeManager } from './themeChoice';

const colorSchemeManager = themeColorSchemeManager();

const platforms: Record<Connection, Platform> = {
  online: appPlatform,
  checking: startingPlatform,
  offline: offlinePlatform,
};

export function App(): JSX.Element {
  const platform = platforms[useConnection()];
  return (
    <MantineProvider
      theme={theme}
      withCssVariables={false}
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="auto"
    >
      <ModalsProvider>
        <Toasts />
        <PlatformProvider value={platform}>
          <RouterProvider router={router} />
        </PlatformProvider>
      </ModalsProvider>
    </MantineProvider>
  );
}
