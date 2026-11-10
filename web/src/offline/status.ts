import { useSyncExternalStore } from 'react';

import { changeSignal } from '../changeSignal';
import { fileSize } from '../components/formats';

import { onMessage, post } from './channel';
import type { AppState } from './keys';
import { readState, type CopyError, type CopyState } from './records';

export interface CopyProgress {
  done: number;
  total: number;
}

export interface OfflineStatus {
  app?: AppState;
  progress?: CopyProgress;
  state?: CopyState;
  error?: CopyError;
  usage?: number;
}

const changed = changeSignal();

let status: OfflineStatus = {};

function update(next: Partial<OfflineStatus>): void {
  status = { ...status, ...next };
  changed.notify();
}

export function progressChanged(progress: CopyProgress | undefined): void {
  update({ progress });
  post({ type: 'progress', done: progress?.done ?? 0, total: progress?.total ?? 0 });
}

export async function refreshStatus(): Promise<void> {
  const [state, estimate] = await Promise.all([
    readState().catch(() => undefined),
    navigator.storage.estimate().catch(() => undefined),
  ]);
  update({ state, usage: estimate?.usage });
}

export function roundEnded(error: CopyError): void {
  update({ error });
}

export function stateChanged(): void {
  post({ type: 'state' });
  void refreshStatus();
}

export function forgetStatus(): void {
  update({ app: undefined, progress: undefined, state: undefined, error: undefined, usage: undefined });
}

export function startStatus(): void {
  onMessage((message) => {
    switch (message.type) {
      case 'app':
        update({ app: message.state });
        if (message.state === 'ready') {
          void refreshStatus();
        }
        break;
      case 'progress':
        update({ progress: message.total === 0 ? undefined : { done: message.done, total: message.total } });
        break;
      case 'ask':
        if (status.progress !== undefined) {
          post({ type: 'progress', done: status.progress.done, total: status.progress.total });
        }
        break;
      case 'state':
      case 'owner':
        update({ error: undefined });
        void refreshStatus();
        break;
      default:
        break;
    }
  });
  post({ type: 'ask' });
  void refreshStatus();
}

export function useOfflineStatus(): OfflineStatus {
  return useSyncExternalStore(changed.subscribe, () => status);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function copyTime(at: number, now: Date = new Date()): string {
  const when = new Date(at);
  return sameDay(when, now)
    ? when.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : when.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

export interface StatusInput {
  supported: boolean;
  wanted: boolean;
  online: boolean;
  status: OfflineStatus;
  now?: Date;
}

export function statusLine({ supported, wanted, online, status: current, now }: StatusInput): string | undefined {
  if (!supported) {
    return 'Needs HTTPS';
  }
  if (!wanted) {
    return undefined;
  }
  const updatedAt = current.state?.updatedAt ?? 0;
  const error = current.error ?? current.state?.error;
  const from = updatedAt > 0 ? `data from ${copyTime(updatedAt, now)}` : undefined;
  if (!online) {
    return from === undefined ? 'No network, nothing downloaded yet' : `No network, ${from}`;
  }
  if (current.progress !== undefined && current.progress.total > 0) {
    return `Downloading... ${current.progress.done} of ${current.progress.total}`;
  }
  if (current.app === 'downloading') {
    return 'Downloading the app...';
  }
  if (error === 'quota' || current.app === 'quota') {
    return from === undefined ? 'Not enough space on this device' : `Not enough space on this device, ${from}`;
  }
  if (error === 'failed' || current.app === 'failed') {
    return from === undefined ? 'Could not update' : `Could not update, ${from}`;
  }
  if (updatedAt === 0) {
    return 'Downloading...';
  }
  const size = current.usage === undefined ? '' : `${fileSize(current.usage)}, `;
  return `${size}updated at ${copyTime(updatedAt, now)}`;
}
