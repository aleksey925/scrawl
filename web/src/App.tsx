import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import type { JSX } from 'react';
import { RouterProvider } from 'react-router';

import { cookieColorSchemeManager } from './colorScheme';
import { router } from './routes';
import { cssVariablesResolver, theme } from './theme';

const colorSchemeManager = cookieColorSchemeManager();

export function App(): JSX.Element {
  return (
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="auto"
    >
      <ModalsProvider>
        <Notifications position="top-right" />
        <RouterProvider router={router} />
      </ModalsProvider>
    </MantineProvider>
  );
}
