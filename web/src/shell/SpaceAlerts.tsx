import { Alert, Code, Stack, Text } from '@mantine/core';
import type { JSX } from 'react';
import { useLocation } from 'react-router';

import { IconAlertTriangle } from '../icons';
import { isProfilePath } from '../paths';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import { useAccount } from './NavContext';
import { ResetAction } from './ResetProvider';
import { factText } from './syncMessage';

export function SpaceAlerts(): JSX.Element {
  const { sync: shown } = useAccount();
  const phone = useBelow(layoutBreakpoints.phone);
  const atProfile = isProfilePath(useLocation().pathname);
  const sync = phone && atProfile ? undefined : shown;

  return (
    <div data-testid="space-alerts" data-empty={sync === undefined} data-print="hide" role="status" aria-live="polite">
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
                <Text size="sm">{factText(entry, false)}</Text>
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
