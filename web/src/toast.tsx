import { randomId } from '@mantine/hooks';
import { notifications, type NotificationData } from '@mantine/notifications';
import { useRef, type JSX, type ReactNode } from 'react';

import type { MutationState } from './api/types';
import { layoutBreakpoints, useBelow } from './theme';
import classes from './toast.module.css';

export type ToastKind = 'ok' | 'error' | 'warn';

export interface ToastAction {
  label: string;
  onClick: () => Promise<boolean>;
  onClose?: () => void;
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

interface ToastContentProps {
  title: string | undefined;
  message: ReactNode;
  action: ReactNode;
}

function ToastContent({ title, message, action }: ToastContentProps): JSX.Element {
  const phone = useBelow(layoutBreakpoints.phone);
  if (phone) {
    return (
      <span className={classes.line}>
        <span data-toast-text className={classes.lineText}>
          {title !== undefined && <span className={classes.title}>{title} </span>}
          {message}
        </span>
        {action}
      </span>
    );
  }
  return (
    <>
      {title !== undefined && <div className={classes.title}>{title}</div>}
      <div className={classes.message}>
        {action === undefined ? (
          message
        ) : (
          <span data-toast-row className={classes.withAction}>
            <span data-toast-text className={classes.text}>{message}</span>
            {action}
          </span>
        )}
      </div>
    </>
  );
}

export function showToast(kind: ToastKind, options: ToastOptions): void {
  const { action } = options;
  const id = randomId('toast-');
  const toast: NotificationData = {
    id,
    message: (
      <ToastContent
        title={options.title}
        message={options.message}
        action={
          action === undefined ? undefined : (
            <ActionButton
              action={action}
              hold={(held) => notifications.update({ ...toast, autoClose: held ? false : actionToastMs })}
              close={() => notifications.hide(id)}
            />
          )
        }
      />
    ),
    autoClose: action === undefined ? undefined : actionToastMs,
    onClose: action?.onClose,
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
