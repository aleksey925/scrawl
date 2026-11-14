import type { JSX, MouseEvent } from 'react';
import { Link, useLocation } from 'react-router';

import { runState, runUrl } from '../paths';

import type { RunLinkProps } from './extensions';
import { useRunInTab } from './runInTab';

export function RunLink({ path, className }: RunLinkProps): JSX.Element {
  const location = useLocation();
  const runInTab = useRunInTab();
  const onClick =
    runInTab === undefined
      ? undefined
      : (event: MouseEvent<HTMLAnchorElement>): void => {
          event.preventDefault();
          runInTab(path);
        };
  return (
    <Link data-testid="dir-row-run" data-row-action to={runUrl(path)} state={runState(location)} className={className} onClick={onClick}>
      Run
    </Link>
  );
}
