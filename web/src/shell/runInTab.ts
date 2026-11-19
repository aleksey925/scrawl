import { api } from '../api/client';
import { ApiError } from '../api/errors';
import { useConnection } from '../offline/connection';
import { offlineSupported, offlineWanted } from '../offline/preference';
import { mountedSpace, readRun, writeRun } from '../offline/records';
import { showToast } from '../toast';

import { needsNetworkTitle, noNetworkText } from './NeedsNetwork';

const noRunRecordText = 'Run this app once with a network to use it offline.';
const notKeptText = 'This browser does not keep this app for offline use.';

export type KeptApp = { kind: 'kept'; url: string } | { kind: 'missing'; message: string };

export function keepsApps(): boolean {
  return offlineSupported() && offlineWanted();
}

export function runFailedText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'The mini app could not be started.';
}

export async function keptApp(path: string): Promise<KeptApp> {
  if (!keepsApps()) {
    return { kind: 'missing', message: noNetworkText };
  }
  const record = await readRun(mountedSpace(), path).catch(() => undefined);
  if (record === undefined) {
    return { kind: 'missing', message: noRunRecordText };
  }
  if (!record.offline) {
    return { kind: 'missing', message: notKeptText };
  }
  return { kind: 'kept', url: record.url };
}

export function framesForgetStorage(): boolean {
  const agent = navigator.userAgent;
  return /AppleWebKit\//.test(agent) && !/Chrome\/|Chromium\/|Android/.test(agent);
}

function framesLoseCookie(): boolean {
  const { protocol, hostname } = window.location;
  return protocol === 'http:' && hostname !== '127.0.0.1' && hostname !== 'localhost' && !hostname.endsWith('.localhost');
}

export function openBlankTab(): Window | null {
  const tab = window.open('', '_blank');
  if (tab === null) {
    showToast('error', { title: 'The new tab was blocked', message: 'Allow pop-ups for this site to open the mini app in a new tab.' });
    return null;
  }
  tab.opener = null;
  return tab;
}

function failTab(tab: Window, error: unknown): void {
  tab.close();
  showToast('error', { title: 'The mini app did not open', message: runFailedText(error) });
}

export function enterInTab(tab: Window, path: string): void {
  api.runTicket(path, keepsApps()).then(
    (ticket) => {
      tab.location.href = ticket.url;
    },
    (error: unknown) => failTab(tab, error),
  );
}

function openKept(tab: Window, path: string): void {
  void keptApp(path).then((kept) => {
    if (kept.kind === 'kept') {
      tab.location.href = kept.url;
      return;
    }
    tab.close();
    showToast('warn', { title: needsNetworkTitle, message: kept.message });
  });
}

export function runInTab(path: string, offline: boolean): void {
  const tab = openBlankTab();
  if (tab === null) {
    return;
  }
  if (offline) {
    openKept(tab, path);
    return;
  }
  const keeps = keepsApps();
  api.runTicket(path, keeps).then(
    (ticket) => {
      tab.location.href = ticket.url;
      if (keeps) {
        void writeRun(mountedSpace(), path, { url: ticket.app, offline: true }).catch(() => undefined);
      }
    },
    (error: unknown) => {
      if (error instanceof TypeError) {
        openKept(tab, path);
      } else {
        failTab(tab, error);
      }
    },
  );
}

export function useRunInTab(): ((path: string) => void) | undefined {
  const connection = useConnection();
  if (!framesForgetStorage() && !framesLoseCookie()) {
    return undefined;
  }
  return (path) => runInTab(path, connection === 'offline');
}
