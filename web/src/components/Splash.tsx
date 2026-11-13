import type { JSX } from 'react';

import { AppLogo } from '../shell/AppLogo';

import './Splash.css';

export function Splash(): JSX.Element {
  return <AppLogo className="scrawl-splash" testId="app-splash" />;
}
