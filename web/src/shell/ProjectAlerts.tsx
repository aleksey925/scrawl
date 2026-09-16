import { Alert, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconCloudOff } from '@tabler/icons-react';
import type { JSX } from 'react';

import { useNav } from './NavContext';

// ProjectAlerts is the one persistent place that says this project is out of
// step. It renders above the outlet, so a reader meets it on every screen
// rather than only after opening one document's history: both states are
// project-wide, and a project whose commits are not leaving the container is
// broken rather than merely worth a note.
export function ProjectAlerts(): JSX.Element | null {
  const { me } = useNav();
  const project = me?.project;
  const degraded = me?.history_degraded === true;
  const unpublished = project?.unpublished === true;

  if (!degraded && !unpublished) {
    return null;
  }

  return (
    <Stack data-testid="project-alerts" gap="sm" mb="lg">
      {degraded && (
        <Alert
          data-testid="history-degraded"
          color="yellow"
          icon={<IconAlertTriangle size={18} />}
          title="History fell behind"
        >
          A change on disk was not recorded, so the versions of a document are behind it.
        </Alert>
      )}
      {unpublished && (
        <Alert
          data-testid="project-unpublished"
          color="yellow"
          icon={<IconCloudOff size={18} />}
          title="Not pushed to the remote"
        >
          <Text size="sm">
            This project holds changes the remote does not have. They are safe on disk here.
          </Text>
          {project.sync_error !== '' && (
            <Text data-testid="project-sync-error" size="sm" mt="xs" style={{ overflowWrap: 'anywhere' }}>
              {project.sync_error}
            </Text>
          )}
        </Alert>
      )}
    </Stack>
  );
}
