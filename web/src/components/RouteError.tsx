import { Alert, Anchor, Stack, Title } from '@mantine/core';
import type { JSX } from 'react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router';

import { errorText } from '../api/useApi';

export function RouteError(): JSX.Element {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : errorText(error);

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
