import { useEffect, type JSX, type ReactNode } from 'react';
import { Outlet } from 'react-router';

import { installUnauthorizedHandler } from '../api/client';
import { goToLogin } from '../login';

import { DocumentExtras } from './DocumentExtras';
import { ReaderExtensionsProvider, type ReaderExtensions } from './extensions';
import { FileActionsProvider } from './FileActions';
import { FileView } from './FileView';
import { NavProvider } from './NavContext';
import { ReaderLayout, type ReaderChrome } from './ReaderLayout';
import { ResetProvider } from './ResetDialog';
import { RowMenu } from './RowMenu';
import { SearchProvider } from './SearchDialog';
import { SpaceAlerts } from './SpaceAlerts';
import { SpaceMenu } from './SpaceMenu';
import { SyncControl } from './SyncControl';
import { TabBar } from './TabBar';
import { useMe } from './useMe';

const extensions: ReaderExtensions = { DocumentExtras, FileView, RowMenu };

const chrome: ReaderChrome = {
  sidebarFoot: <SpaceMenu />,
  topbarEnd: <SyncControl />,
  phoneBottom: <TabBar />,
};

export function AppLayout(): JSX.Element {
  useEffect(() => installUnauthorizedHandler('shell', goToLogin), []);

  return (
    <SpaceNavProvider>
      <ReaderExtensionsProvider value={extensions}>
        <ReaderLayout chrome={chrome} providers={AppProviders} banner={<SpaceAlerts />}>
          <Outlet />
        </ReaderLayout>
      </ReaderExtensionsProvider>
    </SpaceNavProvider>
  );
}

function AppProviders({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ResetProvider>
      <FileActionsProvider>
        <SearchProvider>{children}</SearchProvider>
      </FileActionsProvider>
    </ResetProvider>
  );
}

function SpaceNavProvider({ children }: { children: ReactNode }): JSX.Element {
  return <NavProvider status={useMe()}>{children}</NavProvider>;
}
