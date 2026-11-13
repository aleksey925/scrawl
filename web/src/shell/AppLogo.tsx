import type { JSX } from 'react';

import logo from '../../../server/assets/logo.svg?raw';

import classes from './AppLogo.module.css';

interface AppLogoProps {
  className?: string;
  testId?: string;
}

export function AppLogo({ className = classes.logo, testId }: AppLogoProps): JSX.Element {
  return <span aria-hidden data-testid={testId} className={className} dangerouslySetInnerHTML={{ __html: logo }} />;
}
