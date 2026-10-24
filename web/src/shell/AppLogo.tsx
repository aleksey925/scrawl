import type { JSX } from 'react';

import logo from '../../../server/assets/logo.svg?raw';

import classes from './AppLogo.module.css';

// AppLogo is the app's logo inline, so it is drawn in the icon color through
// currentColor, which an <img> of the same file would not take
export function AppLogo(): JSX.Element {
  return <span aria-hidden className={classes.logo} dangerouslySetInnerHTML={{ __html: logo }} />;
}
