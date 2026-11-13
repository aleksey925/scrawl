import { useSyncExternalStore } from 'react';

import { changeSignal } from '../changeSignal';
import { servedOffline } from '../mount';

import { post } from './channel';
import { fromScrawl, networkDeadlineMs, serverUnreachable } from './keys';
import { offlineSupported, offlineWanted, onChoiceChange, useOfflineWanted } from './preference';

const probeMs = 15_000;

const changed = changeSignal();

const wrote = changeSignal();

let online = navigator.onLine && !servedOffline();

let checking = navigator.onLine && servedOffline();

let checkDeadline: number | undefined;

let probe: number | undefined;

const serverBack = changeSignal();

const lost = changeSignal();

function tellWorker(): void {
  if (!checking) {
    post({ type: 'connection', online });
  }
}

function setOnline(next: boolean): void {
  if (next === online && !checking) {
    return;
  }
  checking = false;
  window.clearTimeout(checkDeadline);
  online = next;
  tellWorker();
  changed.notify();
  watch();
}

function checkTimedOut(): void {
  checking = false;
  tellWorker();
  changed.notify();
  startProbe();
}

async function ping(): Promise<void> {
  if (document.hidden) {
    return;
  }
  tellWorker();
  try {
    const response = await fetch('/ping', { cache: 'no-store', credentials: 'same-origin', redirect: 'manual' });
    if ((fromScrawl(response) || response.ok || turnedAway(response)) && !online) {
      serverBack.notify();
    }
  } catch {
  }
}

function startProbe(): boolean {
  if (online || checking || probe !== undefined || !offlineWanted()) {
    return false;
  }
  probe = window.setInterval(() => void ping(), probeMs);
  return true;
}

function watch(): void {
  if (online && probe !== undefined) {
    window.clearInterval(probe);
    probe = undefined;
  } else if (startProbe()) {
    void ping();
  }
}

export function startConnection(): void {
  if (!offlineSupported()) {
    return;
  }
  window.addEventListener('offline', connectionFailed);
  window.addEventListener('online', () => void ping());
  onChoiceChange(watch);
  tellWorker();
  if (checking) {
    checkDeadline = window.setTimeout(checkTimedOut, networkDeadlineMs);
  }
  watch();
}

export function connectionFailed(): void {
  setOnline(false);
  lost.notify();
}

export function connectionStalled(): void {
  setOnline(false);
}

function turnedAway(response: Response): boolean {
  return response.type === 'opaqueredirect' || response.status === 401 || response.status === 403;
}

function asksToSignIn(response: Response): boolean {
  return turnedAway(response) || (response.ok && response.headers.get('content-type')?.includes('json') !== true);
}

export function serverAnswered(response: Response): void {
  if (serverUnreachable(response)) {
    connectionFailed();
  }
}

export function answeredByGateway(response: Response): boolean {
  return !fromScrawl(response) && asksToSignIn(response);
}

export function confirmOnline(): void {
  setOnline(true);
}

export function isOnline(): boolean {
  return online;
}

export function onConnectionChange(listener: () => void): () => void {
  return changed.subscribe(listener);
}

export function onServerBack(listener: () => void): () => void {
  return serverBack.subscribe(listener);
}

export function onConnectionLost(listener: () => void): () => void {
  return lost.subscribe(listener);
}

export function wroteSomething(): void {
  wrote.notify();
}

export function onWrite(listener: () => void): () => void {
  return wrote.subscribe(listener);
}

export type Connection = 'online' | 'checking' | 'offline';

function currentConnection(): Connection {
  if (online) {
    return 'online';
  }
  return checking ? 'checking' : 'offline';
}

export function useConnection(): Connection {
  const wanted = useOfflineWanted();
  const connection = useSyncExternalStore(changed.subscribe, currentConnection);
  return wanted ? connection : 'online';
}

export function useReadingCopy(): boolean {
  return useConnection() !== 'online';
}
