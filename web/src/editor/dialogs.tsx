import { Button, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { modals } from '@mantine/modals';

import { loginUrl } from '../login';
import { layout } from '../theme';

import classes from './Editor.module.css';

const conflictId = 'editor-conflict';
const sessionId = 'editor-session';

export function confirmLeave(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    modals.openConfirmModal({
      title: 'Leave without saving?',
      children: (
        <Text data-testid="modal" data-variant="confirm" size="sm">
          Your changes are kept as a local draft, but they are not written to disk.
        </Text>
      ),
      labels: { confirm: 'Leave', cancel: 'Stay' },
      confirmProps: { color: 'red', h: layout.tapTarget, 'data-testid': 'modal-confirm' },
      cancelProps: { h: layout.tapTarget, 'data-testid': 'modal-cancel' },
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
      onClose: () => resolve(false),
    });
  });
}

export interface ConflictOptions {
  mine: string;
  theirs: string;
  onOverwrite: () => void;
  onCopy: () => void;
}

export function openConflict({ mine, theirs, onOverwrite, onCopy }: ConflictOptions): void {
  modals.open({
    modalId: conflictId,
    title: 'This file changed on disk',
    size: 'xl',
    children: (
      <Stack data-testid="modal" data-variant="conflict" gap="md">
        <Text size="sm">
          Someone or something else wrote to this file after you started editing.
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Stack gap="xs">
            <Text size="xs" fw={600}>
              Your version
            </Text>
            <pre data-testid="editor-conflict-mine" className={classes.conflictText}>
              {mine}
            </pre>
          </Stack>
          <Stack gap="xs">
            <Text size="xs" fw={600}>
              On disk
            </Text>
            <pre data-testid="editor-conflict-theirs" className={classes.conflictText}>
              {theirs}
            </pre>
          </Stack>
        </SimpleGrid>
        <Group justify="flex-end">
          <Button
            data-testid="editor-conflict-cancel"
            variant="default"
            h={layout.tapTarget}
            onClick={() => modals.close(conflictId)}
          >
            Cancel
          </Button>
          <Button
            data-testid="editor-conflict-copy"
            variant="default"
            h={layout.tapTarget}
            onClick={() => {
              modals.close(conflictId);
              onCopy();
            }}
          >
            Save as copy
          </Button>
          <Button
            data-testid="editor-conflict-overwrite"
            color="red"
            h={layout.tapTarget}
            onClick={() => {
              modals.close(conflictId);
              onOverwrite();
            }}
          >
            Overwrite
          </Button>
        </Group>
      </Stack>
    ),
  });
}

export function openSessionExpired(): void {
  modals.open({
    modalId: sessionId,
    title: 'Your session expired',
    children: (
      <Stack data-testid="modal" data-variant="session" gap="md">
        <Text size="sm">
          Nothing was saved. Your text is still here and kept as a local draft. Sign in again in the
          new tab, then come back and save.
        </Text>
        <Group justify="flex-end">
          <Button
            data-testid="editor-session-dismiss"
            variant="default"
            h={layout.tapTarget}
            onClick={() => modals.close(sessionId)}
          >
            Not now
          </Button>
          <Button
            data-testid="editor-session-signin"
            h={layout.tapTarget}
            onClick={() => {
              window.open(loginUrl(), '_blank', 'noopener');
              modals.close(sessionId);
            }}
          >
            Sign in
          </Button>
        </Group>
      </Stack>
    ),
  });
}
