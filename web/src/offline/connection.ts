import { useSyncExternalStore } from 'react';

import { changeSignal } from '../changeSignal';
import { servedOffline } from '../mount';

import { post } from './channel';
import { offlineSupported, offlineWanted, onChoiceChange, useOfflineWanted } from './preference';

const probeMs = 15_000;

const unavailable = new Set([502, 503, 504]);

const changed = changeSignal();

const wrote = changeSignal();

let online = navigator.onLine && !servedOffline();

let probe: number | undefined;

const serverBack = changeSignal();

const lost = changeSignal();

function tellWorker(): void {
  post({ type: 'connection', online });
}

function setOnline(next: boolean): void {
  if (next === online) {
    return;
  }
  online = next;
  tellWorker();
  changed.notify();
  watch();
}

async function ping(): Promise<void> {
  if (document.hidden) {
    return;
  }
  tellWorker();
  try {
    const response = await fetch('/ping', { cache: 'no-store', credentials: 'same-origin' });
    if (response.ok && !online) {
      serverBack.notify();
    }
  } catch {
  }
}

function watch(): void {
  if (online && probe !== undefined) {
    window.clearInterval(probe);
    probe = undefined;
  } else if (!online && probe === undefined && offlineWanted()) {
    probe = window.setInterval(() => void ping(), probeMs);
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
  watch();
}

export function connectionFailed(): void {
  setOnline(false);
  lost.notify();
}

export function connectionStalled(): void {
  setOnline(false);
}

export function serverAnswered(response: Response): void {
  const fromScrawl = response.headers.get('app-name') === 'scrawl';
  if (unavailable.has(response.status) && !fromScrawl) {
    connectionFailed();
  }
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

export function useOffline(): boolean {
  const wanted = useOfflineWanted();
  const connected = useConnected();
  return wanted && !connected;
}

export function useConnected(): boolean {
  return useSyncExternalStore(changed.subscribe, isOnline);
}
