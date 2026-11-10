import { Anchor, Text } from '@mantine/core';
import { useRef, type JSX, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

import { Page, PageTitle } from '../components/Page';
import { useOffline } from '../offline/connection';
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

function NeedsNetwork({ note }: { note: string | undefined }): JSX.Element {
  usePageChrome(standaloneChrome('Needs a network'));
  return (
    <Page data-testid="app-needs-network">
      <PageTitle>Needs a network</PageTitle>
      <Text c="dimmed" mb="md">
        There is no network, and this page needs the server.
      </Text>
      <Anchor component={Link} to={note === undefined ? '/' : documentUrl(note)}>
        {note === undefined ? 'Back to all notes' : 'Back to the note'}
      </Anchor>
    </Page>
  );
}

export function NetworkGate({ children }: { children: ReactNode }): JSX.Element {
  const location = useLocation();
  const offline = useOffline();
  const entered = useRef({ key: location.key, offline });
  if (entered.current.key !== location.key) {
    entered.current = { key: location.key, offline };
  }
  if (offline && entered.current.offline && networkRoute.test(location.pathname)) {
    return <NeedsNetwork note={noteOf(location.pathname)} />;
  }
  return <>{children}</>;
}
