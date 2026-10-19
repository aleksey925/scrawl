import type { JSX } from 'react';
import { Link } from 'react-router';

import { layoutBreakpoints, useAtLeast } from '../theme';

import classes from './Shell.module.css';

// Wordmark is the name of the app and a way back to the root of the space; a
// phone's bar is a row of icons with no room for a word that is no control
export function Wordmark(): JSX.Element | null {
  const wide = useAtLeast(layoutBreakpoints.compactTopbar);
  if (!wide) {
    return null;
  }
  return (
    <Link data-testid="topbar-wordmark" to="/" className={classes.wordmark}>
      scrawl
    </Link>
  );
}
