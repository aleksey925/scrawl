import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { Outlet } from 'react-router';

import { installUnauthorizedHandler } from '../api/client';
import type { MeResponse } from '../api/types';
import { goToLogin } from '../login';
import { useConnection } from '../offline/connection';
import { offlineMe, storedMe } from '../offline/source';

import { DocumentExtras } from './DocumentExtras';
import { ReaderExtensionsProvider, type ReaderExtensions } from './extensions';
import { FileActionsProvider } from './FileActions';
import { FileView } from './FileView';
import { NavProvider } from './NavContext';
import { NetworkGate } from './NeedsNetwork';
import { OfflineMark } from './OfflineMark';
import { ReaderLayout, type ReaderChrome } from './ReaderLayout';
import { ResetProvider } from './ResetDialog';
import { RowMenu } from './RowMenu';
import { SearchProvider } from './SearchDialog';
import { SpaceAlerts } from './SpaceAlerts';
import { SpaceMenu } from './SpaceMenu';
import { SyncControl } from './SyncControl';
import { TabBar } from './TabBar';
import { useMe, type MeState } from './useMe';

const extensions: ReaderExtensions = { DocumentExtras, FileView, RowMenu };

const chrome: ReaderChrome = {
  sidebarFoot: <SpaceMenu />,
  topbarEnd: (
    <>
      <OfflineMark />
      <SyncControl />
    </>
  ),
  phoneBottom: <TabBar />,
};

export function AppLayout(): JSX.Element {
  useEffect(() => installUnauthorizedHandler('shell', goToLogin), []);

  return (
    <SpaceNavProvider>
      <ReaderExtensionsProvider value={extensions}>
        <ReaderLayout chrome={chrome} providers={AppProviders} banner={<SpaceAlerts />}>
          <NetworkGate>
            <Outlet />
          </NetworkGate>
        </ReaderLayout>
      </ReaderExtensionsProvider>
    </SpaceNavProvider>
  );
}

function AppProviders({ children }: { children: ReactNode }): JSX.Element {
  const offline = useConnection() !== 'online';
  return (
    <ResetProvider>
      <FileActionsProvider>
        <SearchProvider enabled={!offline}>{children}</SearchProvider>
      </FileActionsProvider>
    </ResetProvider>
  );
}

function useStoredMe(wanted: boolean): MeResponse | undefined {
  const [stored, setStored] = useState<MeResponse | undefined>(undefined);
  useEffect(() => {
    if (!wanted) {
      return undefined;
    }
    let current = true;
    void storedMe().then((me) => {
      if (current) {
        setStored(me);
      }
    });
    return () => {
      current = false;
    };
  }, [wanted]);
  return stored;
}

function SpaceNavProvider({ children }: { children: ReactNode }): JSX.Element {
  const live = useMe();
  const offline = useConnection() !== 'online';
  const stored = useStoredMe(offline && live.me === undefined);
  const status = useMemo<MeState>(() => {
    if (!offline) {
      return live;
    }
    const me = live.me ?? stored;
    return { me: me === undefined ? undefined : offlineMe(me), refreshMe: live.refreshMe };
  }, [offline, live, stored]);
  return <NavProvider status={status}>{children}</NavProvider>;
}
