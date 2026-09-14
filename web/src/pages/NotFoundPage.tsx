import { Anchor, Container, Stack, Text, Title } from '@mantine/core';
import type { JSX } from 'react';
import { Link } from 'react-router';

import { layout } from '../theme';

export function Component(): JSX.Element {
  return (
    <Container size={layout.contentMeasure} px={0}>
      <Stack data-testid="app-notfound" gap="md">
        <Title order={1}>Nothing here</Title>
        <Text c="dimmed">That address does not match a note or a folder.</Text>
        <Anchor component={Link} to="/">
          Back to all notes
        </Anchor>
      </Stack>
    </Container>
  );
}
