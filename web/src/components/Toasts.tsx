import { Notifications, notifications, type NotificationData } from '@mantine/notifications';
import { useRef, useState, type JSX, type MouseEvent, type PointerEvent } from 'react';

import { IconAlertTriangle, IconCheck } from '../icons';
import { layout, layoutBreakpoints, useBelow } from '../theme';
import type { ToastKind } from '../toast';

import classes from './Toasts.module.css';

const desktopWidth = 480;
const phoneToastMs = 2500;
const phoneTransitionMs = 350;

function onButton(event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>): boolean {
  return event.target instanceof Element && event.target.closest('button') !== null;
}

function selectsText(): boolean {
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed;
}

function Toast({ data, phone }: { data: NotificationData; phone: boolean }): JSX.Element {
  const tone = data['data-kind'] as ToastKind;
  const Icon = tone === 'ok' ? IconCheck : IconAlertTriangle;
  const startY = useRef<number | undefined>(undefined);
  const [pulled, setPulled] = useState(0);

  const dismiss = (): void => {
    if (data.id !== undefined) {
      notifications.hide(data.id);
    }
  };

  return (
    <div
      data-testid="toast-box"
      className={phone ? `${classes.toast} ${classes.pill}` : classes.toast}
      style={pulled < 0 ? { transform: `translateY(${pulled}px)`, transition: 'none' } : undefined}
      onClick={(event: MouseEvent<HTMLDivElement>) => {
        if (!phone && !onButton(event) && !selectsText()) {
          dismiss();
        }
      }}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (!phone || onButton(event)) {
          return;
        }
        startY.current = event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        if (startY.current !== undefined) {
          setPulled(Math.min(0, event.clientY - startY.current));
        }
      }}
      onPointerUp={() => {
        if (startY.current === undefined) {
          return;
        }
        startY.current = undefined;
        dismiss();
      }}
      onPointerCancel={() => {
        startY.current = undefined;
        setPulled(0);
      }}
    >
      <Icon size={layout.iconSizeSmall} weight="bold" className={classes.icon} data-tone={tone} aria-hidden />
      <div className={classes.body}>
        {data.title !== undefined && <div className={classes.title}>{data.title}</div>}
        <div className={classes.message}>{data.message}</div>
      </div>
    </div>
  );
}

export function Toasts(): JSX.Element {
  const phone = useBelow(layoutBreakpoints.phone);
  return (
    <Notifications
      position={phone ? 'top-center' : 'bottom-center'}
      containerWidth={phone ? '100%' : desktopWidth}
      {...(phone ? { autoClose: phoneToastMs, transitionDuration: phoneTransitionMs } : {})}
      allowDragDismiss={false}
      classNames={{ root: classes.root }}
      renderNotification={(data) => <Toast data={data} phone={phone} />}
    />
  );
}
