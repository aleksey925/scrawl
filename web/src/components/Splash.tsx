import type { JSX } from 'react';

import logo from '../../../server/assets/logo.svg?raw';

import './Splash.css';

export function Splash(): JSX.Element {
  return (
    <div aria-hidden data-testid="app-splash" className="scrawl-splash" dangerouslySetInnerHTML={{ __html: logo }} />
  );
}
