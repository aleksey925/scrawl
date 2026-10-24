import type { JSX, ReactNode } from 'react';

import classes from './Topbar.module.css';
import { TopbarCrumbs } from './TopbarCrumbs';

export interface TopbarProps {
  start?: ReactNode;
  end?: ReactNode;
  actionsRef: (element: HTMLElement | null) => void;
}

export function Topbar({ start, end, actionsRef }: TopbarProps): JSX.Element {
  return (
    <div data-testid="topbar" className={classes.topbar}>
      {start}
      <TopbarCrumbs />

      <div data-testid="topbar-actions" className={classes.actions} ref={actionsRef} />

      {end}
    </div>
  );
}
