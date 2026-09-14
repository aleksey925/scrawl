import { Alert, Center, Loader } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import type { JSX, ReactNode } from 'react';
import { Navigate } from 'react-router';

import { handoffUrl } from '../api/client';
import { errorText, type AsyncState } from '../api/useApi';

export interface AsyncContentProps<T> {
  state: AsyncState<T>;
  // the screen this is standing in for, so its waiting and failed states are
  // reachable under that screen's own name
  testId?: string;
  children: (data: T) => ReactNode;
}

export function AsyncContent<T>({ state, testId, children }: AsyncContentProps<T>): JSX.Element {
  if (state.error !== undefined) {
    const elsewhere = handoffUrl(state.error);
    if (elsewhere !== undefined) {
      return <Navigate to={elsewhere} replace />;
    }
    return (
      <Alert
        data-testid={testId === undefined ? undefined : `${testId}-error`}
        color="red"
        icon={<IconAlertTriangle size={18} />}
        title="That did not work"
      >
        {errorText(state.error)}
      </Alert>
    );
  }
  if (state.data === undefined) {
    return (
      <Center data-testid={testId === undefined ? undefined : `${testId}-loading`} py="3xl">
        <Loader size="sm" />
      </Center>
    );
  }
  return <>{children(state.data)}</>;
}
