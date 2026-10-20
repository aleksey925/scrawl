import type { JSX } from 'react';

import { blockNames } from '../themes';

import classes from './Sidebar.module.css';

// colorOf picks a block color for a name, the same one every time, so a space
// is recognized by its tile before its name is read
function colorOf(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return blockNames[hash % blockNames.length] ?? 'gray';
}

export interface SpaceTileProps {
  name: string;
  small?: boolean;
}

// SpaceTile is a space's mark: the first letter of its name on one of the
// block colors
export function SpaceTile({ name, small = false }: SpaceTileProps): JSX.Element {
  const color = colorOf(name);
  const letter = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <span
      aria-hidden
      data-testid="space-tile"
      data-letter={letter}
      className={small ? `${classes.tile} ${classes.tileSmall}` : classes.tile}
      style={{ background: `var(--scrawl-bg-${color})`, color: `var(--scrawl-color-${color})` }}
    />
  );
}
