import { Box, Button, Center, CloseButton, Group, Loader, Modal, SegmentedControl, Stack, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { useEffect, useState, type JSX } from 'react';

import { api } from '../api/client';
import type { FileResponse, HistoryEntry, HistoryVersionResponse } from '../api/types';
import { errorText, useApi, type AsyncState } from '../api/useApi';
import { AsyncContent } from '../components/AsyncContent';
import { RenderedDiff } from '../diff/RenderedDiff';
import { shortTime } from '../components/formats';
import { localStore, readText, writeText } from '../storage';
import { layoutBreakpoints, useBelow } from '../theme';
import { blockNames } from '../themes';
import { showToast } from '../toast';

import { DiffView } from './DiffView';
import classes from './HistoryDialog.module.css';
import { useNav } from './NavContext';
import { useMutationState } from './useMutationState';

function formatWhen(at: string): string {
  return new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// versionTime is when a version was made, the way a list of them reads: the
// day in words while it is recent, the date after that
export function versionTime(at: string, now: Date = new Date()): string {
  const when = new Date(at);
  const time = when.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const day = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(when)) / 86_400_000);
  if (days === 0) {
    return `Today, ${time}`;
  }
  if (days === 1) {
    return `Yesterday, ${time}`;
  }
  return shortTime(at);
}

// whoOf is the name a version shows: an API token's name without its prefix,
// and a change made outside the app said in words
function whoOf(actor: string): string {
  if (actor === '') {
    return 'unknown';
  }
  if (actor === 'external') {
    return 'outside the app';
  }
  return actor.replace(/^token:/, '');
}

// tagOf is the word beside a version: how it was made, when that was not in
// the app, and otherwise what it did to the note
export function tagOf(entry: HistoryEntry): { label: string; color: string } {
  if (entry.actor.startsWith('token:')) {
    return { label: 'API', color: 'purple' };
  }
  if (entry.actor === 'external') {
    return { label: 'On disk', color: 'orange' };
  }
  switch (entry.kind) {
    case 'added':
      return { label: 'Create', color: 'green' };
    case 'renamed':
      return { label: 'Rename', color: 'blue' };
    case 'deleted':
      return { label: 'Delete', color: 'red' };
    default:
      return { label: 'Edit', color: 'gray' };
  }
}

// avatarColor gives everybody one block color of their own, the same every time
function avatarColor(name: string): string {
  let sum = 0;
  for (const char of name) {
    sum = (sum * 31 + (char.codePointAt(0) ?? 0)) % 9973;
  }
  return blockNames[sum % blockNames.length] ?? 'gray';
}

// sameAsNow is a version holding the text the note has now, which the server
// tells apart from a deletion by the blob a deletion lacks
function sameAsNow(entry: HistoryEntry): boolean {
  return !entry.restorable && entry.blob !== '';
}

function restoreReason(entry: HistoryEntry): string | undefined {
  if (entry.restorable) {
    return undefined;
  }
  return entry.blob === '' ? 'This version was a deletion' : 'Same as the current note';
}

type DiffMode = 'rendered' | 'source';

const diffModeKey = 'scrawl.history.diff';

function useDiffMode(): [DiffMode, (mode: DiffMode) => void] {
  const [mode, setMode] = useState<DiffMode>(() =>
    readText(localStore(), diffModeKey) === 'source' ? 'source' : 'rendered',
  );
  function choose(next: DiffMode): void {
    writeText(localStore(), diffModeKey, next);
    setMode(next);
  }
  return [mode, choose];
}

function VersionDiff({ state, mode }: { state: AsyncState<HistoryVersionResponse | undefined>; mode: DiffMode }): JSX.Element {
  if (state.error !== undefined) {
    return (
      <Text data-testid="history-detail-error" size="sm" c="red">
        {errorText(state.error)}
      </Text>
    );
  }
  if (state.data === undefined) {
    return (
      <Center data-testid="history-detail-loading" py="xl">
        <Loader size="sm" />
      </Center>
    );
  }
  const { changes, diff, rev } = state.data;
  if (changes !== undefined && mode === 'rendered') {
    return <RenderedDiff rows={changes} version={rev} />;
  }
  if (diff === '') {
    return (
      <Text data-testid="history-diff-empty" size="sm" c="dimmed">
        This version left no patch for the note.
      </Text>
    );
  }
  return <DiffView patch={diff} />;
}

interface VersionRowProps {
  entry: HistoryEntry;
  path: string;
  selected: boolean;
  onPick: () => void;
}

function VersionRow({ entry, path, selected, onPick }: VersionRowProps): JSX.Element {
  const who = whoOf(entry.actor);
  const tag = tagOf(entry);
  const color = avatarColor(who);
  return (
    <button
      type="button"
      data-testid="version"
      data-rev={entry.rev}
      data-selected={selected ? 'true' : 'false'}
      aria-current={selected ? 'true' : undefined}
      className={classes.row}
      onClick={onPick}
    >
      <span className={classes.line}>
        <span data-testid="version-when" className={classes.time} title={formatWhen(entry.at)}>
          {versionTime(entry.at)}
          {sameAsNow(entry) && <span className={classes.current}> current</span>}
        </span>
      </span>
      <span className={classes.line}>
        <span
          className={classes.avatar}
          style={{ background: `var(--scrawl-bg-${color})`, color: `var(--scrawl-color-${color})` }}
          aria-hidden
        >
          {who.slice(0, 1).toUpperCase()}
        </span>
        <span data-testid="version-actor" className={classes.actor}>
          {who}
        </span>
        <span
          data-testid="version-kind"
          data-kind={entry.kind}
          className={classes.kind}
          style={{ background: `var(--scrawl-bg-${tag.color})`, color: `var(--scrawl-color-${tag.color})` }}
        >
          {tag.label}
        </span>
      </span>
      {entry.path !== path && (
        <span data-testid="version-moved" className={classes.moved}>
          as {entry.path}
        </span>
      )}
    </button>
  );
}

export interface HistoryDialogProps {
  path: string;
  onClose: () => void;
  // onRestored lets the note behind the dialog read the text written back
  onRestored: () => void;
}

// HistoryDialog is the history of a note over the note itself: what the picked
// version changed on the left, every version on the right, Restore below them
export function HistoryDialog({ path, onClose, onRestored }: HistoryDialogProps): JSX.Element {
  const { canWrite } = useNav();
  const reportMutation = useMutationState();
  const phone = useBelow(layoutBreakpoints.compactTopbar);
  const [mode, setMode] = useDiffMode();

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
  const selected = entries.find((entry) => entry.rev === selectedRev) ?? entries[0];

  const detail = useApi<HistoryVersionResponse | undefined>(
    (signal) =>
      selected === undefined ? Promise.resolve(undefined) : api.historyVersion(selected.path, selected.rev, { signal }),
    [selected?.path, selected?.rev],
  );

  useEffect(() => {
    setSelectedRev((prev) => prev ?? history.data?.entries[0]?.rev);
  }, [history.data]);

  const rev = file.data?.rev;

  async function runRestore(entry: HistoryEntry, base: string): Promise<void> {
    // a second restore carries the revision this page was built from, which the
    // first one has already moved past
    if (restoring) {
      return;
    }
    setRestoring(true);
    try {
      const outcome = await api.restoreVersion(path, { rev: base, version: entry.rev, from: entry.path });
      if (!outcome.ok) {
        setConflict(outcome.current);
        return;
      }
      reportMutation(outcome.state, 'Restored');
      setToken((seen) => seen + 1);
      onRestored();
    } catch (error) {
      showToast('error', { title: 'Restore failed', message: errorText(error) });
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
        <Text data-testid="modal" data-variant="confirm" size="sm">
          The note is overwritten with the version from {formatWhen(entry.at)}. The text it has now stays in history
          and can be restored back.
        </Text>
      ),
      labels: { confirm: 'Restore', cancel: 'Cancel' },
      confirmProps: { 'data-testid': 'modal-confirm' },
      cancelProps: { 'data-testid': 'modal-cancel' },
      onConfirm: () => void runRestore(entry, rev),
    });
  }

  const reason = selected === undefined ? undefined : restoreReason(selected);

  return (
    <>
      <Modal
        opened
        onClose={onClose}
        size={1100}
        fullScreen={phone}
        withCloseButton={false}
        padding={0}
        radius="xl"
        shadow="lg"
        centered
        aria-label="History"
        classNames={{ content: classes.content, body: classes.body }}
      >
        <section data-testid="history-version" className={classes.version}>
          <div className={classes.bar}>
            {detail.data?.changes !== undefined && (
              <SegmentedControl
                data-testid="history-diff-view"
                size="xs"
                value={mode}
                onChange={(value) => setMode(value === 'source' ? 'source' : 'rendered')}
                aria-label="Show the change"
                data={[
                  { value: 'rendered', label: 'Rendered' },
                  { value: 'source', label: 'Source' },
                ]}
              />
            )}
            <span data-testid="history-when" className={classes.when}>
              {selected === undefined ? 'What changed' : `What changed in ${versionTime(selected.at)}`}
            </span>
          </div>
          <div className={classes.diff}>
            {selected !== undefined && <VersionDiff state={detail} mode={mode} />}
          </div>
        </section>

        <aside data-testid="history-list" className={classes.panel}>
          <div className={classes.head}>
            <h2 data-testid="history-title" className={classes.title}>
              Versions
            </h2>
            <span data-testid="history-count" className={classes.count}>
              {history.data?.entries.length}
            </span>
            <CloseButton data-testid="history-close" aria-label="Close the history" onClick={onClose} />
          </div>
          {/* the dialog takes the focus here and not on its close button, which would
              stand ringed the moment it opens */}
          <div className={classes.list} tabIndex={-1} data-autofocus>
            <AsyncContent state={history} testId="history">
              {(data) =>
                data.entries.length === 0 ? (
                  <div data-testid="history-empty" className={classes.empty}>
                    Nothing was recorded for this note.
                  </div>
                ) : (
                  data.entries.map((entry) => (
                    <VersionRow
                      key={entry.rev}
                      entry={entry}
                      path={path}
                      selected={entry.rev === selected?.rev}
                      onPick={() => setSelectedRev(entry.rev)}
                    />
                  ))
                )
              }
            </AsyncContent>
          </div>
          {canWrite && selected !== undefined && (
            <div className={classes.foot}>
              <Button
                data-testid="version-restore"
                fullWidth
                size="md"
                disabled={reason !== undefined || restoring || rev === undefined}
                onClick={() => askRestore(selected)}
              >
                Restore version
              </Button>
              <span data-testid="history-restore-reason" className={classes.reason}>
                {reason ?? 'A restore is a new version. Nothing is lost.'}
              </span>
            </div>
          )}
        </aside>
      </Modal>

      <Modal
        data-testid="modal"
        data-variant="conflict"
        opened={conflict !== undefined}
        onClose={() => setConflict(undefined)}
        title="This page changed while the history was open"
        size="lg"
      >
        <Stack gap="md" style={{ minWidth: 0 }}>
          <Text size="sm">
            Something wrote to the note after the history was opened, so nothing was restored. Reload to see where the
            note stands now, then restore again.
          </Text>
          <Text size="sm" fw={500} c="dimmed">
            On disk now
          </Text>
          <Box
            data-testid="history-conflict-current"
            component="pre"
            style={{
              margin: 0,
              padding: 12,
              maxHeight: 300,
              overflow: 'auto',
              border: '1px solid var(--scrawl-border)',
              borderRadius: 'var(--mantine-radius-md)',
              background: 'var(--scrawl-sidebar)',
              fontFamily: 'var(--mantine-font-family-monospace)',
              fontSize: 12,
            }}
          >
            {conflict ?? ''}
          </Box>
          <Group justify="flex-end" gap="sm">
            <Button data-testid="history-conflict-cancel" variant="default" onClick={() => setConflict(undefined)}>
              Cancel
            </Button>
            <Button
              data-testid="history-conflict-reload"
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
    </>
  );
}
