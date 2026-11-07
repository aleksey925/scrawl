import { randomId } from '@mantine/hooks';
import { notifications, type NotificationData } from '@mantine/notifications';
import { useRef, type JSX, type ReactNode } from 'react';

import type { MutationState } from './api/types';
import classes from './toast.module.css';

export type ToastKind = 'ok' | 'error' | 'warn';

export interface ToastAction {
  label: string;
  onClick: () => Promise<boolean>;
}

export interface ToastOptions {
  title?: string;
  message: ReactNode;
  action?: ToastAction;
}

const actionToastMs = 6000;

interface ActionButtonProps {
  action: ToastAction;
  hold: (held: boolean) => void;
  close: () => void;
}

function ActionButton({ action, hold, close }: ActionButtonProps): JSX.Element {
  const busy = useRef(false);
  return (
    <button
      type="button"
      data-testid="toast-action"
      className={classes.action}
      onClick={() => {
        if (busy.current) {
          return;
        }
        busy.current = true;
        hold(true);
        void action.onClick().then((done) => {
          busy.current = false;
          if (done) {
            close();
          } else {
            hold(false);
          }
        });
      }}
    >
      {action.label}
    </button>
  );
}

export function showToast(kind: ToastKind, options: ToastOptions): void {
  const { action } = options;
  const id = randomId('toast-');
  const toast: NotificationData = {
    id,
    title: options.title,
    message:
      action === undefined ? (
        options.message
      ) : (
        <span className={classes.withAction}>
          <span className={classes.text}>{options.message}</span>
          <ActionButton
            action={action}
            hold={(held) => notifications.update({ ...toast, autoClose: held ? false : actionToastMs })}
            close={() => notifications.hide(id)}
          />
        </span>
      ),
    autoClose: action === undefined ? undefined : actionToastMs,
    'data-testid': 'toast',
    'data-kind': kind,
  };
  notifications.show(toast);
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
