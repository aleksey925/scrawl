import { Tooltip } from '@mantine/core';
import type { JSX, ReactElement, ReactNode } from 'react';

import classes from './Hint.module.css';

export function HintGroup({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Tooltip.Group openDelay={400} closeDelay={100}>
      {children}
    </Tooltip.Group>
  );
}

interface HintProps {
  label: string;
  disabled?: boolean;
  children: ReactElement;
}

export function Hint({ label, disabled = false, children }: HintProps): JSX.Element {
  return (
    <Tooltip label={label} disabled={disabled} classNames={{ tooltip: classes.hint }}>
      {children}
    </Tooltip>
  );
}
