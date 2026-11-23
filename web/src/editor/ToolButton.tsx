import { ActionIcon } from '@mantine/core';
import type { ComponentPropsWithRef, JSX } from 'react';

import { Hint } from '../components/Hint';

import classes from './Editor.module.css';

export interface ToolButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'color' | 'style'> {
  testId: string;
  label: string;
  children: JSX.Element;
}

export function ToolButton({ testId, label, children, ...rest }: ToolButtonProps): JSX.Element {
  return (
    <Hint label={label}>
      <ActionIcon
        {...rest}
        data-testid={testId}
        className={classes.tool}
        variant="subtle"
        color="gray"
        aria-label={label}
        onMouseDown={(event) => event.preventDefault()}
      >
        {children}
      </ActionIcon>
    </Hint>
  );
}
