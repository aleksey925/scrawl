import { UnstyledButton } from '@mantine/core';
import type { ComponentPropsWithRef, JSX } from 'react';

import logo from '../../../server/assets/logo.svg?raw';
import { IconChevronDown } from '../icons';
import { layout } from '../theme';

import classes from './Sidebar.module.css';

export interface SpaceButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'color' | 'style'> {
  name: string;
}

// SpaceButton opens the menu of the space: the app's logo, the space's name and
// the sign of a list to pick from. The foot of the sidebar is it.
export function SpaceButton({ name, ...rest }: SpaceButtonProps): JSX.Element {
  return (
    <UnstyledButton {...rest} data-testid="space-menu" className={classes.spaceButton}>
      <span aria-hidden className={classes.logo} dangerouslySetInnerHTML={{ __html: logo }} />
      <span className={classes.spaceName}>{name}</span>
      <IconChevronDown size={layout.iconSizeSmall} className={classes.spaceSelector} />
    </UnstyledButton>
  );
}
