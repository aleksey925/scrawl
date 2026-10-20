import { UnstyledButton } from '@mantine/core';
import { IconSelector } from '@tabler/icons-react';
import type { ComponentPropsWithRef, JSX } from 'react';

import { layout } from '../theme';

import classes from './Sidebar.module.css';
import { SpaceTile } from './SpaceTile';

export interface SpaceButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'color' | 'style'> {
  name: string;
}

// SpaceButton opens the menu of the space: its tile, its name and the sign of
// a list to pick from. The head of the sidebar starts with it.
export function SpaceButton({ name, ...rest }: SpaceButtonProps): JSX.Element {
  return (
    <UnstyledButton {...rest} data-testid="space-menu" className={classes.spaceButton}>
      <SpaceTile name={name} />
      <span className={classes.spaceName}>{name}</span>
      <IconSelector size={layout.iconSizeSmall} className={classes.spaceSelector} />
    </UnstyledButton>
  );
}
