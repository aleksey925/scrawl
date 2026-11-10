import { ActionIcon } from '@mantine/core';
import type { ComponentPropsWithRef, JSX } from 'react';

import classes from './Editor.module.css';

export interface ToolButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'color' | 'style'> {
  testId: string;
  label: string;
  children: JSX.Element;
}

export function ToolButton({ testId, label, children, ...rest }: ToolButtonProps): JSX.Element {
  return (
    <ActionIcon
      {...rest}
      data-testid={testId}
      className={classes.tool}
      variant="subtle"
      color="gray"
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
    >
      {children}
    </ActionIcon>
  );
}
