import { Alert, Anchor, Stack, Title } from '@mantine/core';
import type { JSX } from 'react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router';

import { errorText } from '../api/useApi';

export function RouteError(): JSX.Element {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : errorText(error);

  return <ErrorView message={message} />;
}

// ErrorView is a screen that broke, for the router that caught it and for the
// boundary a site has instead
export function ErrorView({ message }: { message: string }): JSX.Element {
  return (
    <Stack data-testid="app-error" p="xl" gap="md">
      <Title order={2}>This page broke</Title>
      <Alert data-testid="app-error-message" color="red">
        {message}
      </Alert>
      <Anchor component={Link} to="/">
        Back to all notes
      </Anchor>
    </Stack>
  );
}
