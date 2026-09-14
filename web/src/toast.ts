import { notifications } from '@mantine/notifications';

export type ToastKind = 'ok' | 'error';

export interface ToastOptions {
  title?: string;
  message: string;
}

const toastColors: Record<ToastKind, string> = { ok: 'green', error: 'red' };

export function showToast(kind: ToastKind, options: ToastOptions): void {
  notifications.show({
    color: toastColors[kind],
    title: options.title,
    message: options.message,
    'data-testid': 'toast',
    'data-kind': kind,
  });
}
