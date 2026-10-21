import { Notifications, notifications, type NotificationData } from '@mantine/notifications';
import { useRef, useState, type JSX, type PointerEvent } from 'react';

import { IconAlertTriangle, IconCheck } from '../icons';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import classes from './Toasts.module.css';

function toneOf(data: NotificationData): 'ok' | 'warn' | 'error' {
  return data.color === 'green' ? 'ok' : data.color === 'red' ? 'error' : 'warn';
}

// a tap on the pill puts it away, and so does a flick up, which it follows
function Pill({ data }: { data: NotificationData }): JSX.Element {
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
      className={classes.pill}
      style={pulled < 0 ? { transform: `translateY(${pulled}px)`, transition: 'none' } : undefined}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        startY.current = event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        if (startY.current !== undefined) {
          setPulled(Math.min(0, event.clientY - startY.current));
        }
      }}
      onPointerUp={() => {
        startY.current = undefined;
        dismiss();
      }}
      onPointerCancel={() => {
        startY.current = undefined;
        setPulled(0);
      }}
    >
      <Icon size={layout.iconSizeSmall} weight="bold" className={classes.icon} data-tone={tone} aria-hidden />
      <div>
        {data.title !== undefined && <div className={classes.title}>{data.title}</div>}
        <div className={classes.message}>{data.message}</div>
      </div>
    </div>
  );
}

// Toasts is where every toast is drawn: on a desktop mantine's card at the top
// right, on a phone the pill an app drops from the top for a word or two
export function Toasts(): JSX.Element {
  const phone = useBelow(layoutBreakpoints.phone);
  if (!phone) {
    return <Notifications position="top-right" />;
  }
  return (
    <Notifications
      position="top-center"
      autoClose={2500}
      transitionDuration={350}
      allowDragDismiss={false}
      containerWidth="100%"
      classNames={{ root: classes.root }}
      renderNotification={(data) => <Pill data={data} />}
    />
  );
}
