import { Alert, Code, Stack, Text } from '@mantine/core';
import type { JSX } from 'react';

import { IconAlertTriangle } from '../icons';
import { layout } from '../theme';

import { useNav } from './NavContext';
import { ResetAction } from './ResetDialog';

export function SpaceAlerts(): JSX.Element {
  const { sync } = useNav();

  return (
    <div data-testid="space-alerts" data-print="hide" role="status" aria-live="polite">
      {sync !== undefined && (
        <Alert
          data-testid="space-alert"
          data-kind={sync.kind}
          color="yellow"
          icon={<IconAlertTriangle size={layout.iconSize} />}
          title={sync.title}
          mb="lg"
        >
          <Stack gap="xs">
            {sync.facts.map((entry) => (
              <Stack key={entry.kind} gap={4}>
                <Text size="sm">{entry.body}</Text>
                {entry.reason !== '' && (
                  <Code
                    data-testid="space-alert-reason"
                    block
                    style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {entry.reason}
                  </Code>
                )}
              </Stack>
            ))}
            <ResetAction />
          </Stack>
        </Alert>
      )}
    </div>
  );
}
