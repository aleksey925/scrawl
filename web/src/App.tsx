import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import type { JSX } from 'react';
import { RouterProvider } from 'react-router';

import { router } from './routes';
import { theme } from './theme';
import { cookieColorSchemeManager } from './themeChoice';

const colorSchemeManager = cookieColorSchemeManager();

export function App(): JSX.Element {
  return (
    <MantineProvider
      theme={theme}
      // every variable of every theme is in the theme stylesheet, keyed on an
      // attribute mantine does not know; its runtime copy would outrank them
      withCssVariables={false}
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
