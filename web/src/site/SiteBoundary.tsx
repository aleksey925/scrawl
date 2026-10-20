import { Component, type ReactNode } from 'react';

import { errorText } from '../api/useApi';
import { ErrorView } from '../components/RouteError';

interface BoundaryState {
  error?: unknown;
}

// SiteBoundary is what the app's router does with a screen that throws: the
// router of a site is a plain one and catches nothing
export class SiteBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = {};

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  override render(): ReactNode {
    return this.state.error === undefined ? this.props.children : <ErrorView message={errorText(this.state.error)} />;
  }
}
