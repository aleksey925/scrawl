import {
  Alert, Badge, Box, Button, Center, Code, Container, Flex, Group, Loader, Modal, Paper, Stack,
  Text, Title, UnstyledButton,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconArrowBackUp } from '@tabler/icons-react';
import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import { api } from '../api/client';
import type { FileResponse, HistoryEntry, HistoryVersionResponse } from '../api/types';
import { errorText, useApi, type AsyncState } from '../api/useApi';
import { AsyncContent } from '../components/AsyncContent';
import { documentUrl } from '../paths';
import { DiffView } from '../shell/DiffView';
import { useNav } from '../shell/NavContext';
import { PageActions } from '../shell/ShellSlots';
import { layoutBreakpoints, useBelow } from '../theme';

function formatWhen(at: string): string {
  return new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function ScrollingPre({ text, maxHeight }: { text: string; maxHeight: number }): JSX.Element {
  return (
    <Box
      style={{
        minWidth: 0,
        maxHeight,
        overflow: 'auto',
        border: '1px solid var(--scrawl-border)',
        borderRadius: 'var(--mantine-radius-md)',
        background: 'var(--scrawl-bg-inset)',
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: 12,
          width: 'max-content',
          minWidth: '100%',
          fontFamily: 'var(--mantine-font-family-monospace)',
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {text}
      </pre>
    </Box>
  );
}

function VersionDetail({ state }: { state: AsyncState<HistoryVersionResponse | undefined> }): JSX.Element {
  if (state.error !== undefined) {
    return (
      <Text size="sm" c="red">
        {errorText(state.error)}
      </Text>
    );
  }
  if (state.data === undefined) {
    return (
      <Center py="xl">
        <Loader size="sm" />
      </Center>
    );
  }
  return (
    <Stack gap="md" style={{ minWidth: 0 }}>
      <Text size="xs" tt="uppercase" fw={600} c="dimmed">
        What changed
      </Text>
      {state.data.diff === '' ? (
        <Text size="sm" c="dimmed">
          This version left no patch for the document.
        </Text>
      ) : (
        <DiffView patch={state.data.diff} />
      )}
      {state.data.content !== undefined && (
        <>
          <Text size="xs" tt="uppercase" fw={600} c="dimmed">
            The document at this version
          </Text>
          <ScrollingPre text={state.data.content} maxHeight={320} />
        </>
      )}
    </Stack>
  );
}

interface VersionRowProps {
  entry: HistoryEntry;
  path: string;
  selected: boolean;
  canRestore: boolean;
  restoring: boolean;
  onPick: () => void;
  onRestore: () => void;
  children?: ReactNode;
}

function VersionRow({
  entry, path, selected, canRestore, restoring, onPick, onRestore, children,
}: VersionRowProps): JSX.Element {
  return (
    <Paper
      withBorder
      p="sm"
      radius="md"
      style={{
        minWidth: 0,
        borderColor: selected ? 'var(--scrawl-accent-border)' : undefined,
        background: selected ? 'var(--scrawl-accent-subtle)' : undefined,
      }}
    >
      <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
        <UnstyledButton
          onClick={onPick}
          aria-current={selected ? 'true' : undefined}
          style={{ flex: '1 1 auto', minWidth: 0, textAlign: 'left' }}
        >
          <Stack gap={4} style={{ minWidth: 0 }}>
            <Group gap="xs" wrap="nowrap">
              <Badge size="sm" variant="light" color="gray">
                {entry.kind}
              </Badge>
              <Text size="xs" c="dimmed">
                {formatWhen(entry.at)}
              </Text>
            </Group>
            <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
              {entry.message}
            </Text>
            <Group gap="xs" wrap="nowrap">
              <Text size="xs" c="dimmed">
                {entry.actor === '' ? 'unknown' : entry.actor}
              </Text>
              <Code>{entry.short}</Code>
            </Group>
            {entry.path !== path && (
              <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                as <Code>{entry.path}</Code>
              </Text>
            )}
          </Stack>
        </UnstyledButton>

        {canRestore && (
          <Button
            variant="default"
            size="xs"
            style={{ flex: 'none' }}
            disabled={restoring}
            onClick={onRestore}
          >
            Restore
          </Button>
        )}
      </Group>
      {children}
    </Paper>
  );
}

export function Component(): JSX.Element {
  const params = useParams();
  const path = decodeURIComponent(params['*'] ?? '');
  const { me, canWrite } = useNav();
  const stacked = useBelow(layoutBreakpoints.sidebar);

  const [token, setToken] = useState(0);
  const [selectedRev, setSelectedRev] = useState<string | undefined>(undefined);
  const [restoring, setRestoring] = useState(false);
  const [conflict, setConflict] = useState<string | undefined>(undefined);

  const history = useApi((signal) => api.history(path, { signal }), [path, token]);

  // the revision on disk a restore is checked against. The version list does
  // not carry it, and only a reader who may write ever needs it.
  const file = useApi<FileResponse | undefined>(
    (signal) => (canWrite ? api.file(path, { signal }) : Promise.resolve(undefined)),
    [path, canWrite, token],
  );

  const entries = history.data?.entries ?? [];
  const selected = entries.find((entry) => entry.rev === selectedRev);

  const detail = useApi<HistoryVersionResponse | undefined>(
    (signal) =>
      selected === undefined
        ? Promise.resolve(undefined)
        : api.historyVersion(selected.path, selected.rev, { signal }),
    [selected?.path, selected?.rev],
  );

  useEffect(() => {
    // stacked, a pick opens inside its own row, so expanding the newest version
    // on arrival would bury the list under a screen of diff
    if (stacked) {
      return;
    }
    setSelectedRev((prev) => prev ?? history.data?.entries[0]?.rev);
  }, [stacked, history.data]);

  const rev = file.data?.rev;

  async function runRestore(entry: HistoryEntry, base: string): Promise<void> {
    // a second restore carries the revision this page was built from, which the
    // first one has already moved past
    if (restoring) {
      return;
    }
    setRestoring(true);
    try {
      const outcome = await api.restoreVersion(path, {
        rev: base,
        version: entry.rev,
        from: entry.path,
      });
      if (!outcome.ok) {
        setConflict(outcome.current);
        return;
      }
      notifications.show({ color: 'green', message: 'Restored' });
      setToken((seen) => seen + 1);
    } catch (error) {
      notifications.show({ color: 'red', title: 'Restore failed', message: errorText(error) });
    } finally {
      setRestoring(false);
    }
  }

  function askRestore(entry: HistoryEntry): void {
    if (rev === undefined) {
      return;
    }
    modals.openConfirmModal({
      title: 'Restore this version?',
      children: (
        <Text size="sm">
          The document is overwritten with the version from {formatWhen(entry.at)}. The text it has
          now stays in history and can be restored back.
        </Text>
      ),
      labels: { confirm: 'Restore', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => void runRestore(entry, rev),
    });
  }

  function pick(entry: HistoryEntry): void {
    // stacked, the panel lives inside the row, so the same tap closes it again
    setSelectedRev((prev) => (stacked && prev === entry.rev ? undefined : entry.rev));
  }

  function rows(list: readonly HistoryEntry[]): JSX.Element[] {
    return list.map((entry) => (
      <VersionRow
        key={entry.rev}
        entry={entry}
        path={path}
        selected={entry.rev === selectedRev}
        canRestore={canWrite && rev !== undefined && entry.blob !== ''}
        restoring={restoring}
        onPick={() => pick(entry)}
        onRestore={() => askRestore(entry)}
      >
        {stacked && entry.rev === selectedRev && (
          <Box pt="md" style={{ minWidth: 0 }}>
            <VersionDetail state={detail} />
          </Box>
        )}
      </VersionRow>
    ));
  }

  return (
    <Container fluid px={0} style={{ minWidth: 0 }}>
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

      <Stack gap="xl" style={{ minWidth: 0 }}>
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Title order={1}>History</Title>
          <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
            <Code>{path}</Code>
          </Text>
        </Stack>

        {me?.history_degraded === true && (
          <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="History fell behind">
            A change on disk was not recorded, so this list is behind the document.
          </Alert>
        )}

        <AsyncContent state={history}>
          {(data) =>
            data.entries.length === 0 ? (
              <Text c="dimmed">Nothing was recorded for this note.</Text>
            ) : stacked ? (
              <Stack gap="sm" style={{ minWidth: 0 }}>
                {rows(data.entries)}
              </Stack>
            ) : (
              <Flex gap="xl" align="flex-start" style={{ minWidth: 0 }}>
                <Stack gap="sm" style={{ flex: '1 1 0', minWidth: 0 }}>
                  {rows(data.entries)}
                </Stack>
                <Box style={{ flex: '1 1 0', minWidth: 0 }}>
                  {selected === undefined ? (
                    <Text size="sm" c="dimmed">
                      Pick a version to see what it changed.
                    </Text>
                  ) : (
                    <VersionDetail state={detail} />
                  )}
                </Box>
              </Flex>
            )
          }
        </AsyncContent>
      </Stack>

      <Modal
        opened={conflict !== undefined}
        onClose={() => setConflict(undefined)}
        title="This page changed while the history was open"
        size="lg"
      >
        <Stack gap="md" style={{ minWidth: 0 }}>
          <Text size="sm">
            Something wrote to the document after this page was loaded, so nothing was restored.
            Reload to see where the document stands now, then restore again.
          </Text>
          <Text size="xs" tt="uppercase" fw={600} c="dimmed">
            On disk now
          </Text>
          <ScrollingPre text={conflict ?? ''} maxHeight={300} />
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setConflict(undefined)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConflict(undefined);
                setToken((seen) => seen + 1);
              }}
            >
              Reload
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
