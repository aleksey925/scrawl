import { notifications } from '@mantine/notifications';

import type { MutationState } from './api/types';

export type ToastKind = 'ok' | 'error' | 'warn';

export interface ToastOptions {
  title?: string;
  message: string;
}

const toastColors: Record<ToastKind, string> = { ok: 'green', error: 'red', warn: 'yellow' };

export function showToast(kind: ToastKind, options: ToastOptions): void {
  notifications.show({
    color: toastColors[kind],
    title: options.title,
    message: options.message,
    'data-testid': 'toast',
    'data-kind': kind,
  });
}

export function showMutation(state: MutationState | undefined, message: string): void {
  if (state?.unpublished === true) {
    showToast('warn', { title: 'Not pushed to the remote', message: `${message}, but only here.` });
    return;
  }
  if (state?.history_degraded === true) {
    showToast('warn', { title: 'History fell behind', message: `${message}, but not recorded.` });
    return;
  }
  showToast('ok', { message });
}
