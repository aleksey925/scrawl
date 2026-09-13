import { Badge, Button, Container, Group, Stack, Text, Title } from '@mantine/core';
import { IconArrowBackUp } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link, useParams } from 'react-router';

import { api } from '../api/client';
import { useApi } from '../api/useApi';
import { AsyncContent } from '../components/AsyncContent';
import { documentUrl } from '../paths';
import { PageActions } from '../shell/ShellSlots';
import { layout } from '../theme';

export function Component(): JSX.Element {
  const params = useParams();
  const path = decodeURIComponent(params['*'] ?? '');
  const state = useApi((signal) => api.history(path, { signal }), [path]);

  return (
    <Container size={layout.contentMeasure} px={0}>
      <PageActions>
        <Button
          component={Link}
          to={documentUrl(path)}
          variant="default"
          size="xs"
          leftSection={<IconArrowBackUp size={16} />}
        >
          Back to note
        </Button>
      </PageActions>

      <Stack gap="xl">
        <Title order={1}>History: {path}</Title>
        <AsyncContent state={state}>
          {(history) =>
            history.entries.length === 0 ? (
              <Text c="dimmed">Nothing was recorded for this note.</Text>
            ) : (
              <Stack gap="md">
                {history.entries.map((entry) => (
                  <Group key={entry.rev} justify="space-between" wrap="nowrap">
                    <Stack gap={2}>
                      <Text size="sm">{entry.message}</Text>
                      <Text size="xs" c="dimmed">
                        {entry.actor} - {new Date(entry.at).toLocaleString()}
                      </Text>
                    </Stack>
                    <Badge variant="light" color="gray">
                      {entry.short}
                    </Badge>
                  </Group>
                ))}
              </Stack>
            )
          }
        </AsyncContent>
      </Stack>
    </Container>
  );
}
