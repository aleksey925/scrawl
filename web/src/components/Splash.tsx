import type { JSX } from 'react';

import logo from '../../../server/assets/logo.svg?raw';

import classes from './Splash.module.css';

export function Splash(): JSX.Element {
  return <div aria-hidden className={classes.splash} dangerouslySetInnerHTML={{ __html: logo }} />;
}
