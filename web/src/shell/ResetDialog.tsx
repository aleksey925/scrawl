import { Anchor, Button, Checkbox, Code, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type JSX, type ReactNode,
} from 'react';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import type { Divergence, ResetResponse } from '../api/types';
import { errorText } from '../api/useApi';
import { DialogActions } from '../components/DialogActions';
import { EntryIcon } from '../components/EntryIcon';
import { mountBase } from '../mount';
import { documentUrl, isMarkdown, rawUrl } from '../paths';
import { layout } from '../theme';

import { useNav } from './NavContext';
import classes from './ResetDialog.module.css';

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
      closeOnEscape={step.name !== 'resetting'}
      withCloseButton={false}
      centered
      title={titleOf(step)}
      size={dialogWidth}
      classNames={{ root: classes.dialog, header: classes.header, title: classes.title, body: classes.body }}
    >
      {step.name === 'checking' && (
        <Group gap="sm">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">
            Checking for conflicting files…
          </Text>
        </Group>
      )}

      {(step.name === 'ready' || step.name === 'resetting') && (
        <Stack gap={12}>
          {step.name === 'ready' && step.note !== '' && (
            <Text data-testid="reset-moved" size="sm" c="dimmed">
              {step.note}
            </Text>
          )}
          <LossReport check={step.check} />
          {!step.check.clean && step.check.can_push_backup && (
            <Checkbox
              data-testid="reset-push-backup"
              size="xs"
              checked={pushBackup}
              disabled={step.name === 'resetting'}
              onChange={(event) => setPushBackup(event.currentTarget.checked)}
              label="Push the backup branch to remote"
            />
          )}
          <DialogActions mt={8}>
            <Button data-testid="modal-cancel" variant="default" onClick={close} disabled={step.name === 'resetting'}>
              Cancel
            </Button>
            <Button data-testid="modal-confirm" loading={step.name === 'resetting'} onClick={() => reset(step.check)}>
              Replace
            </Button>
          </DialogActions>
        </Stack>
      )}

      {step.name === 'done' && (
        <Stack gap={12}>
          <BackupReport result={step.result} />
          <DialogActions mt={8}>
            <Button data-testid="reset-reload" onClick={reload}>
              Reload the page
            </Button>
          </DialogActions>
        </Stack>
      )}

      {step.name === 'failed' && (
        <Stack gap={12}>
          {step.inStep ? (
            <Text data-testid="reset-in-step" size="sm" c="dimmed">
              The local copy already matches the remote repository.
            </Text>
          ) : (
            <Text data-testid="reset-failed" size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
              {step.message}
            </Text>
          )}
          <DialogActions mt={8}>
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

const dialogWidth = 400;

function titleOf(step: Step): string {
  switch (step.name) {
    case 'done':
      return 'Local copy replaced';
    case 'failed':
      return step.inStep ? 'Nothing to replace' : 'The local copy was not replaced';
    default:
      return 'Replace local copy?';
  }
}

const outcome = 'After this, the local copy matches the remote repository and sync resumes.';

function LossReport({ check }: { check: Divergence }): JSX.Element {
  const links = useMemo(() => check.lost.paths.map((lost) => ({ path: lost, href: noteHref(lost) })), [check.lost.paths]);

  if (check.clean) {
    return (
      <Text data-testid="reset-clean" size="sm" c="dimmed">
        {outcome} All local changes are already in the remote repository, so nothing will be lost.
      </Text>
    );
  }
  if (links.length === 0) {
    return (
      <Text data-testid="reset-lost" size="sm" c="dimmed">
        {outcome}{' '}
        {check.lost.many
          ? 'Too many conflicting files to list.'
          : 'The conflicting files could not be listed, so treat every local change as conflicting.'}{' '}
        The local version is saved to a backup branch first, so nothing is lost.
      </Text>
    );
  }
  return (
    <Stack data-testid="reset-lost" gap={12}>
      <Text size="sm" c="dimmed">
        {outcome} These files are saved to a backup branch first:
      </Text>
      <Stack data-testid="reset-lost-paths" gap={2} py={6} px="sm" className={classes.files}>
        {links.map(({ path, href }) => (
          <Group key={path} gap={8} wrap="nowrap" className={classes.file}>
            <EntryIcon name={path} size={layout.iconSizeTiny} className={classes.fileIcon} />
            <Anchor href={href} target="_blank" rel="noreferrer" underline="hover" className={classes.link}>
              {path}
            </Anchor>
          </Group>
        ))}
      </Stack>
    </Stack>
  );
}

function BackupReport({ result }: { result: ResetResponse }): JSX.Element {
  if (result.backup === '') {
    return (
      <Text data-testid="reset-done" size="sm" c="dimmed">
        Nothing was lost, so no backup branch was made.
      </Text>
    );
  }
  return (
    <Text data-testid="reset-done" size="sm" c="dimmed">
      The local version is saved to the branch <Code data-testid="reset-backup">{result.backup}</Code>
      {result.backup_pushed ? ' and pushed to remote.' : '. It was not pushed to remote.'}
    </Text>
  );
}

function noteHref(path: string): string {
  return isMarkdown(path) ? mountBase() + documentUrl(path) : rawUrl(path);
}
