import type { JSX } from 'react';

import { layoutBreakpoints, useBelow } from '../theme';

import { TopbarAction } from './TopbarAction';

export function EditAction({ testId, to }: { testId: string; to: string }): JSX.Element | null {
  const phone = useBelow(layoutBreakpoints.phone);
  return phone ? null : <TopbarAction testId={testId} label="Edit" to={to} />;
}
