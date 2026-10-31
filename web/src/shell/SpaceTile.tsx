import type { JSX } from 'react';

import { blockColorOf, blockStyle } from '../themes';

import classes from './Sidebar.module.css';

export function SpaceTile({ name }: { name: string }): JSX.Element {
  const letter = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <span
      aria-hidden
      data-testid="space-tile"
      data-letter={letter}
      className={classes.tile}
      style={blockStyle(blockColorOf(name))}
    />
  );
}
