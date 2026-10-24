import type { JSX } from 'react';
import { Link } from 'react-router';

import { IconPencil } from '../icons';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import classes from './EditButton.module.css';
import { TopbarAction } from './TopbarAction';

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
