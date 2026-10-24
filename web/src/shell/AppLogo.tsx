import type { JSX } from 'react';

import logo from '../../../server/assets/logo.svg?raw';

import classes from './AppLogo.module.css';

export function AppLogo(): JSX.Element {
  return <span aria-hidden className={classes.logo} dangerouslySetInnerHTML={{ __html: logo }} />;
}
