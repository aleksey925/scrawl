import { ActionIcon } from '@mantine/core';
import { useEffect, useRef, useState, type JSX } from 'react';
import { Link, useLocation, useParams } from 'react-router';

import { api, installUnauthorizedHandler } from '../api/client';
import controls from '../controls.module.css';
import { enterMessage } from '../htmlapp/protocol';
import { IconChevronLeft, IconOpenOutside } from '../icons';
import { goToLogin } from '../login';
import { useConnection } from '../offline/connection';
import { mountedSpace, writeRun } from '../offline/records';
import { runBack } from '../paths';
import { basenameOf, parentOf } from '../shell/naming';
import { needsNetworkTitle, ScreenMessage } from '../shell/NeedsNetwork';
import { enterInTab, keepsApps, keptApp, openBlankTab, runFailedText } from '../shell/runInTab';
import { useMe } from '../shell/useMe';
import { layout } from '../theme';

import classes from './RunPage.module.css';

const frameSandbox =
  'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads';

const frameAllow = 'clipboard-write; fullscreen';

const appIndex = 'index.html';

interface RunFrame {
  src: string;
  app: string;
  kept: boolean;
}

type RunState =
  | { kind: 'waiting' }
  | { kind: 'frame'; frame: RunFrame }
  | { kind: 'failed'; message: string }
  | { kind: 'offline'; message: string };

async function offlineState(path: string): Promise<RunState> {
  const kept = await keptApp(path);
  if (kept.kind === 'missing') {
    return { kind: 'offline', message: kept.message };
  }
  return { kind: 'frame', frame: { src: kept.url, app: kept.url, kept: true } };
}

function runName(path: string): string {
  const folder = parentOf(path);
  return basenameOf(path) === appIndex && folder !== '' ? basenameOf(folder) : basenameOf(path);
}

export function Component(): JSX.Element {
  const location = useLocation();
  const path = useParams()['*'] ?? '';
  return <RunScreen key={location.key} path={path} back={runBack(location.state, path)} />;
}

function RunScreen({ path, back }: { path: string; back: string }): JSX.Element {
  useEffect(() => installUnauthorizedHandler('shell', goToLogin), []);
  useMe();
  const connection = useConnection();
  const [state, setState] = useState<RunState>({ kind: 'waiting' });
  const [enteredKept, setEnteredKept] = useState(false);
  const framed = state.kind === 'frame';
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (framed || connection === 'checking') {
      return undefined;
    }
    let current = true;
    const settle = (next: RunState): void => {
      if (current) {
        setState(next);
      }
    };
    if (connection === 'offline') {
      void offlineState(path).then(settle);
    } else {
      api.runTicket(path, keepsApps()).then(
        (ticket) => settle({ kind: 'frame', frame: { src: ticket.url, app: ticket.app, kept: false } }),
        (error: unknown) => {
          if (error instanceof TypeError) {
            void offlineState(path).then(settle);
          } else if (!(error instanceof DOMException && error.name === 'AbortError')) {
            settle({ kind: 'failed', message: runFailedText(error) });
          }
        },
      );
    }
    return () => {
      current = false;
    };
  }, [connection, framed, path]);

  const app = state.kind === 'frame' ? state.frame.app : undefined;
  const kept = state.kind === 'frame' && (state.frame.kept || enteredKept);

  useEffect(() => {
    if (app === undefined) {
      return undefined;
    }
    const origin = new URL(app).origin;
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== origin) {
        return;
      }
      const data = event.data as { type?: unknown; offline?: unknown } | null;
      if (data?.type !== enterMessage || typeof data.offline !== 'boolean' || !keepsApps()) {
        return;
      }
      setEnteredKept(data.offline);
      void writeRun(mountedSpace(), path, { url: app, offline: data.offline }).catch(() => undefined);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [app, path]);

  const openOutside = (): void => {
    const tab = openBlankTab();
    if (tab === null) {
      return;
    }
    if (connection === 'offline' && app !== undefined) {
      tab.location.href = app;
      return;
    }
    enterInTab(tab, path);
  };

  const name = runName(path);
  const outsideAvailable = connection !== 'offline' || kept;

  return (
    <div className={classes.screen} data-testid="run">
      <header className={classes.bar} data-testid="run-bar">
        <Link data-testid="run-back" to={back} className={`${controls.wayBack} ${classes.back}`} aria-label="Back" title="Back">
          <IconChevronLeft size={layout.iconSize} />
        </Link>
        <span className={classes.name} data-testid="run-name" title={name}>
          {name}
        </span>
        <ActionIcon
          data-testid="run-open-outside"
          variant="subtle"
          color="gray"
          size="lg"
          aria-label="Open in a new tab"
          title="Open in a new tab"
          disabled={!outsideAvailable}
          onClick={openOutside}
        >
          <IconOpenOutside size={layout.iconSize} />
        </ActionIcon>
      </header>
      {state.kind === 'frame' && (
        <iframe
          ref={frameRef}
          data-testid="run-frame"
          className={classes.frame}
          src={state.frame.src}
          title={name}
          referrerPolicy="no-referrer"
          sandbox={frameSandbox}
          allow={frameAllow}
        />
      )}
      {state.kind === 'failed' && <RunMessage testId="run-error" back={back} message={state.message} />}
      {state.kind === 'offline' && (
        <RunMessage testId="run-needs-network" back={back} title={needsNetworkTitle} message={state.message} />
      )}
    </div>
  );
}

interface RunMessageProps {
  testId: string;
  back: string;
  message: string;
  title?: string;
}

function RunMessage({ testId, back, message, title }: RunMessageProps): JSX.Element {
  return (
    <div className={classes.message} data-testid={testId}>
      <ScreenMessage title={title} message={message} to={back} back="Back" />
    </div>
  );
}
