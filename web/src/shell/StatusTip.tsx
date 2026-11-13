import { Popover } from '@mantine/core';
import type { JSX } from 'react';

import classes from './StatusTip.module.css';

export const statusTipTarget = classes.target;

interface StatusTipProps {
  testId: string;
  title: string;
  line?: string | undefined;
}

export function StatusTip({ testId, title, line }: StatusTipProps): JSX.Element {
  return (
    <Popover.Dropdown data-testid={testId} className={classes.tip}>
      <div data-testid="status-tip">
        <div>{title}</div>
        {line !== undefined && <div className={classes.line}>{line}</div>}
      </div>
    </Popover.Dropdown>
  );
}
