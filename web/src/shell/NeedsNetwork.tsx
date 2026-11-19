import { Anchor, Text } from '@mantine/core';
import { useRef, type JSX, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

import { Page, PageTitle } from '../components/Page';
import { useConnection } from '../offline/connection';
import { documentUrl } from '../paths';

import { standaloneChrome, usePageChrome } from './PageChrome';

const networkRoute = /^\/(edit|history)\/(.+)$|^\/search$/;

function noteOf(pathname: string): string | undefined {
  const encoded = networkRoute.exec(pathname)?.[2];
  if (encoded === undefined) {
    return undefined;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

export const needsNetworkTitle = 'Needs a network';

export const noNetworkText = 'There is no network, and this page needs the server.';

interface ScreenMessageProps {
  title?: string;
  message: string;
  to: string;
  back: string;
}

export function ScreenMessage({ title, message, to, back }: ScreenMessageProps): JSX.Element {
  return (
    <>
      {title !== undefined && <PageTitle>{title}</PageTitle>}
      <Text c="dimmed" mb="md">
        {message}
      </Text>
      <Anchor component={Link} to={to}>
        {back}
      </Anchor>
    </>
  );
}

function NeedsNetwork({ note }: { note: string | undefined }): JSX.Element {
  usePageChrome(standaloneChrome(needsNetworkTitle));
  return (
    <Page data-testid="app-needs-network">
      <ScreenMessage
        title={needsNetworkTitle}
        message={noNetworkText}
        to={note === undefined ? '/' : documentUrl(note)}
        back={note === undefined ? 'Back to all notes' : 'Back to the note'}
      />
    </Page>
  );
}

export function NetworkGate({ children }: { children: ReactNode }): JSX.Element | null {
  const location = useLocation();
  const connection = useConnection();
  const page = useRef({ key: location.key, reachedServer: false });
  if (page.current.key !== location.key) {
    page.current = { key: location.key, reachedServer: false };
  }
  if (connection === 'online') {
    page.current.reachedServer = true;
  }
  if (networkRoute.test(location.pathname)) {
    if (connection === 'checking') {
      return null;
    }
    if (connection === 'offline' && !page.current.reachedServer) {
      return <NeedsNetwork note={noteOf(location.pathname)} />;
    }
  }
  return <>{children}</>;
}
