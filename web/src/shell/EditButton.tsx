import { IconPencil } from '../icons';
import type { JSX } from 'react';
import { Link } from 'react-router';

import { layout, layoutBreakpoints, useBelow } from '../theme';

import classes from './EditButton.module.css';

// EditButton is the way into the editor on a phone: a round button above the
// tab bar, where the thumb is, and not in a corner of the top bar it is not
export function EditButton({ to }: { to: string }): JSX.Element | null {
  const phone = useBelow(layoutBreakpoints.phone);
  if (!phone) {
    return null;
  }
  return (
    <Link data-testid="edit-button" to={to} className={classes.button} aria-label="Edit" data-print="hide">
      <IconPencil size={layout.iconSize + 2} />
    </Link>
  );
}
