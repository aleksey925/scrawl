import type { JSX } from 'react';

import classes from './StatusTip.module.css';

export const statusTip = { dropdown: classes.tip, target: classes.target };

export function StatusTip({ title, line }: { title: string; line?: string }): JSX.Element {
  return (
    <div data-testid="status-tip">
      <div>{title}</div>
      {line !== undefined && <div className={classes.line}>{line}</div>}
    </div>
  );
}
