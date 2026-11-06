import { Notifications, notifications, type NotificationData } from '@mantine/notifications';
import { useRef, useState, type JSX, type PointerEvent } from 'react';

import { IconAlertTriangle, IconCheck } from '../icons';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import classes from './Toasts.module.css';

const desktopWidth = 480;

function toneOf(data: NotificationData): 'ok' | 'warn' | 'error' {
  return data.color === 'green' ? 'ok' : data.color === 'red' ? 'error' : 'warn';
}

function onButton(event: PointerEvent<HTMLDivElement>): boolean {
  return event.target instanceof Element && event.target.closest('button') !== null;
}

function Toast({ data, phone }: { data: NotificationData; phone: boolean }): JSX.Element {
  const tone = toneOf(data);
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
      data-testid="toast-pill"
      className={phone ? `${classes.toast} ${classes.pill}` : classes.toast}
      style={pulled < 0 ? { transform: `translateY(${pulled}px)`, transition: 'none' } : undefined}
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
  if (!phone) {
    return (
      <Notifications
        position="bottom-center"
        containerWidth={desktopWidth}
        allowDragDismiss={false}
        classNames={{ root: classes.root }}
        renderNotification={(data) => <Toast data={data} phone={false} />}
      />
    );
  }
  return (
    <Notifications
      position="top-center"
      autoClose={2500}
      transitionDuration={350}
      allowDragDismiss={false}
      containerWidth="100%"
      classNames={{ root: classes.root }}
      renderNotification={(data) => <Toast data={data} phone />}
    />
  );
}
