import { Alert, Center, Loader } from '@mantine/core';
import { IconAlertTriangle } from '../icons';
import type { JSX, ReactNode } from 'react';
import { Navigate } from 'react-router';

import { handoffOf } from '../api/errors';
import { errorText, type AsyncState } from '../api/useApi';
import { layout } from '../theme';

import { Page } from './Page';
import { ScreenReady } from './screenMotion';

export interface AsyncContentProps<T> {
  state: AsyncState<T>;
  // the screen this is standing in for, so its waiting and failed states are
  // reachable under that screen's own name
  testId?: string;
  // page draws the waiting and the failure on a page of their own, for a
  // screen whose answer is the whole page
  page?: boolean;
  children: (data: T) => ReactNode;
}

export function AsyncContent<T>({ state, testId, page = false, children }: AsyncContentProps<T>): JSX.Element {
  const framed = (content: JSX.Element): JSX.Element => (page ? <Page>{content}</Page> : content);
  if (state.error !== undefined) {
    const elsewhere = handoffOf(state.error);
    if (elsewhere !== undefined) {
      return <Navigate to={elsewhere.url} replace />;
    }
    return framed(
      <Alert
        data-testid={testId === undefined ? undefined : `${testId}-error`}
        color="red"
        icon={<IconAlertTriangle size={layout.iconSize} />}
        title="That did not work"
      >
        {errorText(state.error)}
      </Alert>,
    );
  }
  if (state.data === undefined) {
    return (
      <ScreenReady value={false}>
        {framed(
          <Center data-testid={testId === undefined ? undefined : `${testId}-loading`} py="3xl">
            <Loader size="sm" />
          </Center>,
        )}
      </ScreenReady>
    );
  }
  return <ScreenReady value={!state.stale}>{children(state.data)}</ScreenReady>;
}
