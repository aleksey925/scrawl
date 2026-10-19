import { useEffect, type JSX, type ReactNode } from 'react';
import { Outlet } from 'react-router';

import { installUnauthorizedHandler } from '../api/client';
import { goToLogin } from '../login';

import { AccountMenu } from './AccountMenu';
import { AppMoreMenu } from './AppMoreMenu';
import { DocumentExtras } from './DocumentExtras';
import { ReaderExtensionsProvider, type ReaderExtensions } from './extensions';
import { FileActionsProvider } from './FileActions';
import { NavProvider } from './NavContext';
import { ReaderLayout } from './ReaderLayout';
import { ResetProvider } from './ResetDialog';
import { RowMenu } from './RowMenu';
import { SearchSpotlight } from './SearchSpotlight';
import { SpaceAlerts } from './SpaceAlerts';
import { SpaceSwitcher } from './SpaceSwitcher';
import { SyncControl } from './SyncControl';
import type { TopbarChrome } from './Topbar';
import { useMe } from './useMe';
import { Wordmark } from './Wordmark';

const extensions: ReaderExtensions = { DocumentExtras, RowMenu };

const chrome: TopbarChrome = {
  start: (
    <>
      <Wordmark />
      <SpaceSwitcher />
    </>
  ),
  wide: (
    <>
      <SyncControl />
      <AccountMenu />
    </>
  ),
  compact: <AppMoreMenu />,
};

// AppLayout is the reader with what the server makes possible around it: the
// spaces, the sync state, the account, search, and every write
export function AppLayout(): JSX.Element {
  useEffect(() => installUnauthorizedHandler('shell', goToLogin), []);

  return (
    <SpaceNavProvider>
      <ReaderExtensionsProvider value={extensions}>
        <ReaderLayout chrome={chrome} providers={AppProviders} banner={<SpaceAlerts />} overlays={<SearchSpotlight />}>
          <Outlet />
        </ReaderLayout>
      </ReaderExtensionsProvider>
    </SpaceNavProvider>
  );
}

function AppProviders({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ResetProvider>
      <FileActionsProvider>{children}</FileActionsProvider>
    </ResetProvider>
  );
}

// the space's state is polled here and not in the layout, so a poll re-renders
// what reads the navigation state and nothing else
function SpaceNavProvider({ children }: { children: ReactNode }): JSX.Element {
  return <NavProvider status={useMe()}>{children}</NavProvider>;
}
