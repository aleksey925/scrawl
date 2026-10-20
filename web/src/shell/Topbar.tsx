import type { JSX, ReactNode } from 'react';

import classes from './Topbar.module.css';
import { TopbarCrumbs } from './TopbarCrumbs';

export interface TopbarProps {
  // the control that brings the sidebar back, where it is put away
  start?: ReactNode;
  // what the app adds at the end, the sync state
  end?: ReactNode;
  actionsRef: (element: HTMLElement | null) => void;
}

// Topbar is the head of the page's column: the path of the page on screen and
// the page's actions. Search and the space live in the sidebar.
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
