import { Anchor, Stack, Text, Title } from '@mantine/core';
import type { JSX } from 'react';
import { Link } from 'react-router';

import { PageContainer } from '../shell/PageContainer';

export function Component(): JSX.Element {
  return (
    <PageContainer>
      <Stack data-testid="app-notfound" gap="md">
        <Title order={1}>Nothing here</Title>
        <Text c="dimmed">That address does not match a note or a folder.</Text>
        <Anchor component={Link} to="/">
          Back to all notes
        </Anchor>
      </Stack>
    </PageContainer>
  );
}
