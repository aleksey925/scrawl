import { Alert, Code, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import type { JSX } from 'react';

import { useNav } from './NavContext';

// ProjectAlerts is the one persistent place that explains what is wrong with
// this project. It renders above the outlet, so a reader meets it on every
// screen rather than only after opening one document's history.
//
// One box and never two. At most two states are true at once - one remote, one
// about recording - and the winner supplies the title while the body carries
// both facts with their own reasons. Two amber boxes above every screen would
// be the opposite of calm; one box with two sentences is not.
//
// There is no close button: a state that is still true should not be hideable,
// and remembering a dismissal would mean a reader who dismissed once never
// hears about the next failure.
export function ProjectAlerts(): JSX.Element {
  const { sync } = useNav();

  // the live region is mounted at all times, even empty: one inserted into the
  // DOM at the same moment as its text is unreliably announced, one already
  // there announces the insertion. Polite, because nothing here is an
  // emergency and an interruption mid-sentence is the surprise this design is
  // trying to avoid.
  return (
    <div data-testid="project-alerts" role="status" aria-live="polite">
      {sync !== undefined && (
        <Alert
          data-testid="project-alert"
          data-kind={sync.kind}
          color="yellow"
          icon={<IconAlertTriangle size={18} />}
          title={sync.title}
          mb="lg"
        >
          <Stack gap="xs">
            {sync.facts.map((fact) => (
              <Stack key={fact.kind} gap={4}>
                <Text size="sm">{fact.body}</Text>
                {fact.reason !== '' && (
                  <Code
                    data-testid="project-alert-reason"
                    block
                    style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {fact.reason}
                  </Code>
                )}
              </Stack>
            ))}
          </Stack>
        </Alert>
      )}
    </div>
  );
}
