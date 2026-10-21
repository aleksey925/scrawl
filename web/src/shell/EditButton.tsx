import type { JSX } from 'react';
import { Link } from 'react-router';

import { IconPencil } from '../icons';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import classes from './EditButton.module.css';
import { TopbarAction } from './TopbarAction';

// EditAction is the way into the editor: a word in the topbar, and on a phone a
// round button above the tab bar, where the thumb is, and not in a corner of
// the top bar it is not
export function EditAction({ testId, to }: { testId: string; to: string }): JSX.Element {
  const phone = useBelow(layoutBreakpoints.phone);
  if (!phone) {
    return <TopbarAction testId={testId} label="Edit" to={to} />;
  }
  return (
    <Link data-testid="edit-button" to={to} className={classes.button} aria-label="Edit" data-print="hide">
      <IconPencil size={layout.iconSizeLarge} />
    </Link>
  );
}
