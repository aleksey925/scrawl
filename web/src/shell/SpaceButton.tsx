import { UnstyledButton } from '@mantine/core';
import type { ComponentPropsWithRef, JSX } from 'react';

import { IconChevronDown } from '../icons';
import { layout } from '../theme';

import { AppLogo } from './AppLogo';
import classes from './Sidebar.module.css';

export interface SpaceButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'color' | 'style'> {
  name: string;
}

export function SpaceButton({ name, ...rest }: SpaceButtonProps): JSX.Element {
  return (
    <UnstyledButton {...rest} data-testid="space-menu" className={classes.spaceButton}>
      <AppLogo />
      <span className={classes.spaceName}>{name}</span>
      <IconChevronDown size={layout.iconSizeSmall} className={classes.spaceSelector} />
    </UnstyledButton>
  );
}
