import { notifications } from '@mantine/notifications';
import type { JSX, ReactNode } from 'react';

import type { MutationState } from './api/types';
import classes from './toast.module.css';

export type ToastKind = 'ok' | 'error' | 'warn';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  title?: string;
  message: ReactNode;
  action?: ToastAction;
}

const actionToastMs = 6000;

export function showToast(kind: ToastKind, options: ToastOptions): void {
  const { action } = options;
  const id = notifications.show({
    title: options.title,
    message:
      action === undefined ? (
        options.message
      ) : (
        <span className={classes.withAction}>
          <span>{options.message}</span>
          <button
            type="button"
            data-testid="toast-action"
            className={classes.action}
            onClick={() => {
              notifications.hide(id);
              action.onClick();
            }}
          >
            {action.label}
          </button>
        </span>
      ),
    autoClose: action === undefined ? undefined : actionToastMs,
    'data-testid': 'toast',
    'data-kind': kind,
  });
}

export function ToastLink({ children, onClick }: { children: ReactNode; onClick: () => void }): JSX.Element {
  return (
    <button type="button" data-testid="toast-link" className={classes.link} onClick={onClick}>
      {children}
    </button>
  );
}

export function showMutation(state: MutationState | undefined, message: ReactNode, action?: ToastAction): void {
  if (state?.unpublished === true) {
    showToast('warn', { title: 'Not pushed to the remote', message: <>{message}, but only here.</>, action });
    return;
  }
  if (state?.history_degraded === true) {
    showToast('warn', { title: 'History fell behind', message: <>{message}, but not recorded.</>, action });
    return;
  }
  showToast('ok', { message, action });
}
