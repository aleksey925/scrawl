import { Notifications, type NotificationData } from '@mantine/notifications';
import type { JSX } from 'react';

import { IconAlertTriangle, IconCheck } from '../icons';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import classes from './Toasts.module.css';

function toneOf(data: NotificationData): 'ok' | 'warn' | 'error' {
  return data.color === 'green' ? 'ok' : data.color === 'red' ? 'error' : 'warn';
}

function Pill({ data }: { data: NotificationData }): JSX.Element {
  const tone = toneOf(data);
  const Icon = tone === 'ok' ? IconCheck : IconAlertTriangle;
  return (
    <div className={classes.pill}>
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
      containerWidth="100%"
      classNames={{ root: classes.root }}
      renderNotification={(data) => <Pill data={data} />}
    />
  );
}
