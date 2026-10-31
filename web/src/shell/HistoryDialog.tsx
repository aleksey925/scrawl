import {
  ActionIcon,
  Button,
  Center,
  CloseButton,
  Group,
  Loader,
  MANTINE_TRANSITIONS,
  Modal,
  Stack,
  Text,
  type MantineTransition,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { useEffect, useState, type JSX } from 'react';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import type { HistoryEntry, HistoryVersionResponse } from '../api/types';
import { errorText, useApi, type AsyncState } from '../api/useApi';
import { AsyncContent } from '../components/AsyncContent';
import { absoluteTime, versionTime } from '../components/formats';
import { Segmented, type SegmentedOption } from '../components/Segmented';
import { RenderedDiff, type DiffLayout } from '../diff/RenderedDiff';
import { IconMaximize, IconMinimize } from '../icons';
import { localStore, readText, writeText } from '../storage';
import { layout, layoutBreakpoints, useBelow } from '../theme';
import { blockColorOf, blockStyle, type BlockName } from '../themes';
import { showToast } from '../toast';

import { DiffView } from './DiffView';
import classes from './HistoryDialog.module.css';
import { useNav } from './NavContext';
import { useMutationState } from './useMutationState';

function whoOf(actor: string): string {
  if (actor === '') {
    return 'unknown';
  }
  if (actor === 'external') {
    return 'outside the app';
  }
  return actor.replace(/^token:/, '');
}

function tagOf(entry: HistoryEntry): { label: string; color: BlockName } {
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

function sameAsNow(entry: HistoryEntry): boolean {
  return !entry.restorable && entry.blob !== '';
}

async function diskRev(path: string, signal: AbortSignal): Promise<string> {
  try {
    return (await api.file(path, { signal })).rev;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return '';
    }
    throw error;
  }
}

function restoreReason(entry: HistoryEntry): string | undefined {
  if (entry.restorable) {
    return undefined;
  }
  return entry.blob === '' ? 'This version was a deletion' : 'Same as the current note';
}

type DiffMode = 'rendered' | 'source';

const diffModes: readonly [DiffMode, ...DiffMode[]] = ['rendered', 'source'];

const diffModeOptions: SegmentedOption<DiffMode>[] = [
  { value: 'rendered', label: 'Rendered' },
  { value: 'source', label: 'Source' },
];

const diffLayouts: readonly [DiffLayout, ...DiffLayout[]] = ['split', 'unified'];

const diffLayoutOptions: SegmentedOption<DiffLayout>[] = [
  { value: 'split', label: 'Split' },
  { value: 'unified', label: 'Unified' },
];

const dialogSizes = ['normal', 'expanded'] as const;

const expandedGap = 16;

const dialogTransition: MantineTransition = {
  ...MANTINE_TRANSITIONS['fade-down'],
  transitionProperty: 'opacity, transform, flex-basis, height',
};

function useStoredChoice<T extends string>(key: string, values: readonly [T, ...T[]]): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = readText(localStore(), key);
    return values.find((entry) => entry === stored) ?? values[0];
  });
  function choose(next: T): void {
    writeText(localStore(), key, next);
    setValue(next);
  }
  return [value, choose];
}

interface VersionDiffProps {
  state: AsyncState<HistoryVersionResponse | undefined>;
  rev: string;
  mode: DiffMode;
  layout: DiffLayout;
}

function VersionDiff({ state, rev, mode, layout }: VersionDiffProps): JSX.Element {
  if (state.error !== undefined) {
    return (
      <Text data-testid="history-detail-error" size="sm" c="red">
        {errorText(state.error)}
      </Text>
    );
  }
  if (state.data?.rev !== rev) {
    return (
      <Center data-testid="history-detail-loading" py="xl">
        <Loader size="sm" />
      </Center>
    );
  }
  const { changes, diff } = state.data;
  if (changes !== undefined && mode === 'rendered') {
    return <RenderedDiff rows={changes} layout={layout} oldLabel="Before" newLabel="This version" version={rev} />;
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
  const color = blockColorOf(who);
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
        <span data-testid="version-when" className={classes.time} title={absoluteTime(entry.at)}>
          {versionTime(entry.at)}
          {sameAsNow(entry) && <span className={classes.current}> current</span>}
        </span>
      </span>
      <span className={classes.line}>
        <span
          className={classes.avatar}
          style={blockStyle(color)}
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
          style={blockStyle(tag.color)}
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
  onNoteChanged: () => void;
}

export function HistoryDialog({ path, onClose, onNoteChanged }: HistoryDialogProps): JSX.Element {
  const { canWrite } = useNav();
  const reportMutation = useMutationState();
  const phone = useBelow(layoutBreakpoints.phone);
  const [mode, setMode] = useStoredChoice('scrawl.history.diff', diffModes);
  const [diffLayout, setDiffLayout] = useStoredChoice('scrawl.history.layout', diffLayouts);
  const [size, setSize] = useStoredChoice('scrawl.history.size', dialogSizes);
  const expanded = size === 'expanded' && !phone;

  const [token, setToken] = useState(0);
  const [selectedRev, setSelectedRev] = useState<string | undefined>(undefined);
  const [restoring, setRestoring] = useState(false);
  const [conflict, setConflict] = useState<string | undefined>(undefined);

  const history = useApi((signal) => api.history(path, { signal }), [path, token]);

  const disk = useApi<string | undefined>(
    (signal) => (canWrite ? diskRev(path, signal) : Promise.resolve(undefined)),
    [path, canWrite, token],
  );

  const entries = history.data?.entries ?? [];
  const selected = entries.find((row) => row.rev === selectedRev) ?? entries[0];

  const detail = useApi<HistoryVersionResponse | undefined>(
    (signal) =>
      selected === undefined ? Promise.resolve(undefined) : api.historyVersion(selected.path, selected.rev, { signal }),
    [selected?.path, selected?.rev],
  );

  useEffect(() => {
    setSelectedRev((prev) => prev ?? history.data?.entries[0]?.rev);
  }, [history.data]);

  const rev = disk.data;

  async function runRestore(entry: HistoryEntry, base: string): Promise<void> {
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
      onNoteChanged();
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
          The note is overwritten with the version from {absoluteTime(entry.at)}. The text it has now stays in history
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
        size={expanded ? '100%' : 1100}
        xOffset={expanded ? expandedGap : undefined}
        yOffset={expanded ? expandedGap : undefined}
        fullScreen={phone}
        transitionProps={{ transition: dialogTransition }}
        withCloseButton={false}
        padding={0}
        centered
        aria-label="History"
        classNames={{ content: classes.content, body: classes.body }}
        data-testid="history-dialog"
        data-expanded={expanded ? 'true' : 'false'}
      >
        <section data-testid="history-version" className={classes.version}>
          <div className={classes.bar}>
            {detail.data?.changes !== undefined && (
              <Segmented
                data-testid="history-diff-view"
                className={classes.toggle}
                size="xs"
                value={mode}
                onChange={setMode}
                aria-label="Show the change"
                options={diffModeOptions}
              />
            )}
            {detail.data?.changes !== undefined && mode === 'rendered' && (
              <Segmented
                data-testid="history-diff-layout"
                className={classes.toggle}
                size="xs"
                value={diffLayout}
                onChange={setDiffLayout}
                aria-label="Lay out the change"
                options={diffLayoutOptions}
              />
            )}
            <span data-testid="history-when" className={classes.when}>
              {selected === undefined ? 'What changed' : `What changed in ${versionTime(selected.at)}`}
            </span>
          </div>
          <div className={classes.diff}>
            {selected !== undefined && <VersionDiff state={detail} rev={selected.rev} mode={mode} layout={diffLayout} />}
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
            {!phone && (
              <ActionIcon
                data-testid="history-expand"
                variant="subtle"
                color="gray"
                aria-label={expanded ? 'Shrink the history' : 'Expand the history'}
                title={expanded ? 'Shrink' : 'Expand'}
                aria-pressed={expanded}
                onClick={() => setSize(expanded ? 'normal' : 'expanded')}
              >
                {expanded ? <IconMinimize size={layout.iconSizeSmall} /> : <IconMaximize size={layout.iconSizeSmall} />}
              </ActionIcon>
            )}
            <CloseButton data-testid="history-close" aria-label="Close the history" onClick={onClose} />
          </div>
          <div className={classes.list} tabIndex={-1} data-autofocus>
            <AsyncContent state={history} testId="history">
              {(data) =>
                data.entries.length === 0 ? (
                  <div data-testid="history-empty" className={classes.empty}>
                    Nothing was recorded for this note.
                  </div>
                ) : (
                  data.entries.map((version) => (
                    <VersionRow
                      key={version.rev}
                      entry={version}
                      path={path}
                      selected={version.rev === selected?.rev}
                      onPick={() => setSelectedRev(version.rev)}
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
                disabled={reason !== undefined || restoring || rev === undefined || disk.loading || history.loading}
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
          <pre data-testid="history-conflict-current" className={classes.conflictText}>
            {conflict ?? ''}
          </pre>
          <Group justify="flex-end" gap="sm">
            <Button data-testid="history-conflict-cancel" variant="default" onClick={() => setConflict(undefined)}>
              Cancel
            </Button>
            <Button
              data-testid="history-conflict-reload"
              onClick={() => {
                setConflict(undefined);
                setToken((seen) => seen + 1);
                onNoteChanged();
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
