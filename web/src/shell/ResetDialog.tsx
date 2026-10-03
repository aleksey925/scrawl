import { Alert, Anchor, Button, Checkbox, Code, Group, List, Loader, Modal, Stack, Text } from '@mantine/core';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type JSX, type ReactNode,
} from 'react';

import { ApiError, api } from '../api/client';
import type { Divergence, ResetResponse } from '../api/types';
import { errorText } from '../api/useApi';
import { mountBase } from '../mount';
import { documentUrl, isMarkdown, rawUrl } from '../paths';

import { useNav } from './NavContext';

const ResetContext = createContext<(() => void) | undefined>(undefined);

// ResetProvider owns the one reset dialog. The banner and the sync popover both
// offer the reset, and the popover unmounts what is in it the moment it
// closes, so the dialog cannot live inside either.
export function ResetProvider({ children }: { children: ReactNode }): JSX.Element {
  const [opened, setOpened] = useState(false);
  const open = useCallback(() => setOpened(true), []);
  const close = useCallback(() => setOpened(false), []);

  return (
    <ResetContext.Provider value={open}>
      {children}
      {opened && <ResetDialog onClose={close} />}
    </ResetContext.Provider>
  );
}

// ResetAction is the way out of a diverged project, drawn wherever the message
// about it is.
export function ResetAction({ onOpen }: { onOpen?: () => void }): JSX.Element | null {
  const open = useContext(ResetContext);
  const { sync } = useNav();
  if (open === undefined || sync?.canReset !== true) {
    return null;
  }
  return (
    <Group>
      <Button
        data-testid="sync-reset"
        size="xs"
        variant="default"
        onClick={() => {
          onOpen?.();
          open();
        }}
      >
        Reset to the remote version…
      </Button>
    </Group>
  );
}

type Step =
  | { name: 'checking' }
  | { name: 'ready'; check: Divergence; note: string }
  | { name: 'resetting'; check: Divergence }
  | { name: 'done'; result: ResetResponse }
  // inStep is a project a sync brought back by itself: nothing to reset, and
  // good news rather than a failure
  | { name: 'failed'; message: string; inStep: boolean };

const movedNote = 'The project changed while this dialog was open, so it was checked again.';

// the two routes answer 409 for one thing only, a project no longer diverged
function isInStep(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

function ResetDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { refreshMe } = useNav();
  const [step, setStep] = useState<Step>({ name: 'checking' });
  const [pushBackup, setPushBackup] = useState(true);

  const check = useCallback((note: string) => {
    setStep({ name: 'checking' });
    api
      .syncCheck()
      .then((res) => setStep({ name: 'ready', check: res, note }))
      .catch((error: unknown) => {
        setStep({ name: 'failed', message: errorText(error), inStep: isInStep(error) });
      });
  }, []);

  useEffect(() => check(''), [check]);

  const reset = (current: Divergence): void => {
    setStep({ name: 'resetting', check: current });
    api
      .syncReset({
        head: current.head,
        remote: current.remote,
        push_backup: pushBackup && current.can_push_backup && !current.clean,
      })
      .then((result) => setStep({ name: 'done', result }))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 412) {
          check(movedNote);
          return;
        }
        setStep({ name: 'failed', message: errorText(error), inStep: isInStep(error) });
      });
  };

  // every note on screen is from the copy that was just replaced, and the
  // screens do not refetch on their own, so the page starts over
  const reload = (): void => window.location.reload();

  const close = (): void => {
    if (step.name === 'done') {
      reload();
      return;
    }
    // a check syncs, so the state may have moved even when nothing was reset
    refreshMe();
    onClose();
  };

  return (
    <Modal
      data-testid="modal"
      data-variant="reset"
      data-step={step.name}
      opened
      onClose={close}
      closeOnClickOutside={step.name !== 'resetting'}
      withCloseButton={step.name !== 'resetting'}
      title="Reset to the remote version"
      size="md"
    >
      {step.name === 'checking' && (
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm">Checking what would be lost…</Text>
        </Group>
      )}

      {(step.name === 'ready' || step.name === 'resetting') && (
        <Stack gap="md">
          {step.name === 'ready' && step.note !== '' && (
            <Text data-testid="reset-moved" size="sm" c="dimmed">
              {step.note}
            </Text>
          )}
          <Text size="sm">
            This copy will hold exactly what the remote holds. Notes changed on the remote arrive, and this copy
            starts sending and receiving again.
          </Text>
          <LossReport check={step.check} />
          {!step.check.clean && step.check.can_push_backup && (
            <Checkbox
              data-testid="reset-push-backup"
              checked={pushBackup}
              disabled={step.name === 'resetting'}
              onChange={(event) => setPushBackup(event.currentTarget.checked)}
              label="Also send the backup branch to the remote"
              description="Turn it off if the remote was rewritten to remove something for good."
            />
          )}
          <Group justify="flex-end" gap="sm">
            <Button data-testid="modal-cancel" variant="default" onClick={close} disabled={step.name === 'resetting'}>
              Cancel
            </Button>
            <Button
              data-testid="modal-confirm"
              color="yellow"
              loading={step.name === 'resetting'}
              onClick={() => reset(step.check)}
            >
              Reset
            </Button>
          </Group>
        </Stack>
      )}

      {step.name === 'done' && (
        <Stack gap="md">
          <Alert data-testid="reset-done" color="green" title="This project is on the remote version now">
            <BackupReport result={step.result} />
          </Alert>
          <Group justify="flex-end">
            <Button data-testid="reset-reload" onClick={reload}>
              Reload the page
            </Button>
          </Group>
        </Stack>
      )}

      {step.name === 'failed' && (
        <Stack gap="md">
          {step.inStep ? (
            <Alert data-testid="reset-in-step" color="green" title="Nothing to reset">
              This project is back in step with the remote.
            </Alert>
          ) : (
            <Alert data-testid="reset-failed" color="red" title="Nothing was reset">
              <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                {step.message}
              </Text>
            </Alert>
          )}
          <Group justify="flex-end" gap="sm">
            <Button data-testid="modal-cancel" variant="default" onClick={close}>
              Close
            </Button>
            {!step.inStep && (
              <Button data-testid="reset-retry" onClick={() => check('')}>
                Check again
              </Button>
            )}
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

const backupSentence = 'This copy is kept in a backup branch first, so nothing is deleted for good.';

// LossReport answers the one question a reset raises, before it is confirmed.
function LossReport({ check }: { check: Divergence }): JSX.Element {
  const links = useMemo(() => check.lost.paths.map((path) => ({ path, href: noteHref(path) })), [check.lost.paths]);

  if (check.clean) {
    return (
      <Alert data-testid="reset-clean" color="green" title="Nothing will be lost">
        Everything changed in this copy is already on the remote.
      </Alert>
    );
  }
  return (
    <Alert data-testid="reset-lost" color="yellow" title="Some changes exist only in this copy">
      <Stack gap="xs">
        {links.length > 0 && (
          <>
            <Text size="sm">The reset replaces these with the remote version:</Text>
            <List data-testid="reset-lost-paths" size="sm" spacing={4} withPadding>
              {links.map(({ path, href }) => (
                <List.Item key={path} style={{ overflowWrap: 'anywhere' }}>
                  {/* a new tab, so looking at a note does not throw the check away */}
                  <Anchor href={href} target="_blank" rel="noreferrer" size="sm">
                    {path}
                  </Anchor>
                </List.Item>
              ))}
            </List>
          </>
        )}
        {links.length === 0 && (
          <Text size="sm">
            {check.lost.many
              ? 'Many files are affected, too many to list.'
              : 'They could not be listed, so treat every note changed here as affected.'}
          </Text>
        )}
        <Text size="sm">{backupSentence}</Text>
      </Stack>
    </Alert>
  );
}

function BackupReport({ result }: { result: ResetResponse }): JSX.Element {
  if (result.backup === '') {
    return <Text size="sm">Nothing was lost, so no backup was needed.</Text>;
  }
  return (
    <Text size="sm">
      What this copy held is kept in the branch <Code data-testid="reset-backup">{result.backup}</Code>,{' '}
      {result.backup_pushed
        ? 'which is on the remote too.'
        : 'in the copy on the server only. It is not on the remote.'}
    </Text>
  );
}

// noteHref is physical, because it opens in a tab of its own and no router is
// there to prepend the project.
function noteHref(path: string): string {
  return isMarkdown(path) ? mountBase() + documentUrl(path) : rawUrl(path);
}
