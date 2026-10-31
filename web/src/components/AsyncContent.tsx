import { Alert, Center, Loader } from '@mantine/core';
import type { JSX, ReactNode } from 'react';
import { Navigate } from 'react-router';

import { handoffOf } from '../api/errors';
import { errorText, type AsyncState } from '../api/useApi';
import { IconAlertTriangle } from '../icons';
import { RouteChrome } from '../shell/PageChrome';
import { layout } from '../theme';

import classes from './AsyncContent.module.css';
import { Page } from './Page';
import { ScreenReady } from './screenMotion';

export interface AsyncContentProps<T> {
  state: AsyncState<T>;
  testId?: string;
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
      <>
        {page && <RouteChrome />}
        <Alert
          data-testid={testId === undefined ? undefined : `${testId}-error`}
          color="red"
          icon={<IconAlertTriangle size={layout.iconSize} />}
          title="That did not work"
        >
          {errorText(state.error)}
        </Alert>
      </>,
    );
  }
  if (state.data === undefined) {
    return (
      <ScreenReady value={false}>
        {framed(
          <Center data-testid={testId === undefined ? undefined : `${testId}-loading`} py="3xl" className={classes.waiting}>
            <Loader size="sm" />
          </Center>,
        )}
      </ScreenReady>
    );
  }
  return <ScreenReady value={!state.stale}>{children(state.data)}</ScreenReady>;
}
