import { Alert, Anchor } from '@mantine/core';
import type { JSX } from 'react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router';

import { errorText } from '../api/useApi';

import { Page, PageTitle } from './Page';

export function RouteError(): JSX.Element {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : errorText(error);

  return <ErrorView message={message} />;
}

export function ErrorView({ message }: { message: string }): JSX.Element {
  return (
    <Page data-testid="app-error">
      <PageTitle>This page broke</PageTitle>
      <Alert data-testid="app-error-message" color="red" mb="md">
        {message}
      </Alert>
      <Anchor component={Link} to="/">
        Back to all notes
      </Anchor>
    </Page>
  );
}
