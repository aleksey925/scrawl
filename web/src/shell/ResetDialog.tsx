import { Alert, Anchor, Button, Checkbox, Code, Group, List, Loader, Modal, Stack, Text } from '@mantine/core';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type JSX, type ReactNode,
} from 'react';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import type { Divergence, ResetResponse } from '../api/types';
import { errorText } from '../api/useApi';
import { DialogActions } from '../components/DialogActions';
import { mountBase } from '../mount';
import { documentUrl, isMarkdown, rawUrl } from '../paths';

import { useNav } from './NavContext';
import { conflictingFiles } from './syncMessage';

const ResetContext = createContext<(() => void) | undefined>(undefined);

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

export function ResetAction(): JSX.Element | null {
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
        onClick={open}
      >
        Replace local copy…
      </Button>
    </Group>
  );
}

type Step =
  | { name: 'checking' }
  | { name: 'ready'; check: Divergence; note: string }
  | { name: 'resetting'; check: Divergence }
  | { name: 'done'; result: ResetResponse }
  | { name: 'failed'; message: string; inStep: boolean };

const movedNote = 'Something changed while this window was open, so the files were checked again.';

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

  const reload = (): void => window.location.reload();

  const close = (): void => {
    if (step.name === 'done') {
      reload();
      return;
    }
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
      title="Replace local copy"
      size="md"
    >
      {step.name === 'checking' && (
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm">Checking for conflicting files…</Text>
        </Group>
      )}

      {(step.name === 'ready' || step.name === 'resetting') && (
        <Stack gap="md">
          {step.name === 'ready' && step.note !== '' && (
            <Text data-testid="reset-moved" size="sm" c="dimmed">
              {step.note}
            </Text>
          )}
          <Text size="sm">After this, the local copy matches the remote repository and sync resumes.</Text>
          <LossReport check={step.check} />
          {!step.check.clean && step.check.can_push_backup && (
            <Checkbox
              data-testid="reset-push-backup"
              checked={pushBackup}
              disabled={step.name === 'resetting'}
              onChange={(event) => setPushBackup(event.currentTarget.checked)}
              label="Push the backup branch to remote"
            />
          )}
          <DialogActions>
            <Button data-testid="modal-cancel" variant="default" onClick={close} disabled={step.name === 'resetting'}>
              Cancel
            </Button>
            <Button
              data-testid="modal-confirm"
              color="yellow"
              loading={step.name === 'resetting'}
              onClick={() => reset(step.check)}
            >
              Replace
            </Button>
          </DialogActions>
        </Stack>
      )}

      {step.name === 'done' && (
        <Stack gap="md">
          <Alert data-testid="reset-done" color="green" title="The local copy is replaced">
            <BackupReport result={step.result} />
          </Alert>
          <DialogActions>
            <Button data-testid="reset-reload" onClick={reload}>
              Reload the page
            </Button>
          </DialogActions>
        </Stack>
      )}

      {step.name === 'failed' && (
        <Stack gap="md">
          {step.inStep ? (
            <Alert data-testid="reset-in-step" color="green" title="Nothing to replace">
              The local copy already matches the remote repository.
            </Alert>
          ) : (
            <Alert data-testid="reset-failed" color="red" title="The local copy was not replaced">
              <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                {step.message}
              </Text>
            </Alert>
          )}
          <DialogActions>
            <Button data-testid="modal-cancel" variant="default" onClick={close}>
              Close
            </Button>
            {!step.inStep && (
              <Button data-testid="reset-retry" onClick={() => check('')}>
                Check again
              </Button>
            )}
          </DialogActions>
        </Stack>
      )}
    </Modal>
  );
}

const backupSentence = 'The local version is saved to a backup branch, so nothing is lost.';

function LossReport({ check }: { check: Divergence }): JSX.Element {
  const links = useMemo(() => check.lost.paths.map((lost) => ({ path: lost, href: noteHref(lost) })), [check.lost.paths]);

  if (check.clean) {
    return (
      <Alert data-testid="reset-clean" color="green" title="Nothing will be lost">
        All local changes are already in the remote repository.
      </Alert>
    );
  }
  return (
    <Alert data-testid="reset-lost" color="yellow">
      <Stack gap="xs">
        {links.length > 0 && (
          <>
            <Text size="sm">{conflictingFiles}</Text>
            <List data-testid="reset-lost-paths" size="sm" spacing={4} withPadding>
              {links.map(({ path, href }) => (
                <List.Item key={path} style={{ overflowWrap: 'anywhere' }}>
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
              ? 'Too many conflicting files to list.'
              : 'The conflicting files could not be listed, so treat every local change as conflicting.'}
          </Text>
        )}
        <Text size="sm">{backupSentence}</Text>
      </Stack>
    </Alert>
  );
}

function BackupReport({ result }: { result: ResetResponse }): JSX.Element {
  if (result.backup === '') {
    return <Text size="sm">Nothing was lost, so no backup branch was made.</Text>;
  }
  return (
    <Text size="sm">
      The local version is saved to the branch <Code data-testid="reset-backup">{result.backup}</Code>
      {result.backup_pushed ? ' and pushed to remote.' : '. It was not pushed to remote.'}
    </Text>
  );
}

function noteHref(path: string): string {
  return isMarkdown(path) ? mountBase() + documentUrl(path) : rawUrl(path);
}
