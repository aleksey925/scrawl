import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import type { JSX } from 'react';
import { RouterProvider } from 'react-router';

import { appPlatform, offlinePlatform, startingPlatform } from './appPlatform';
import { Toasts } from './components/Toasts';
import { useCheckingConnection, useOffline } from './offline/connection';
import { PlatformProvider } from './platform';
import { router } from './routes';
import { theme } from './theme';
import { themeColorSchemeManager } from './themeChoice';

const colorSchemeManager = themeColorSchemeManager();

export function App(): JSX.Element {
  const offline = useOffline();
  const checking = useCheckingConnection();
  const platform = offline ? (checking ? startingPlatform : offlinePlatform) : appPlatform;
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
