import type { MeResponse } from '../api/types';

export interface SyncMessage {
  kind: SyncKind;
  title: string;
  facts: SyncFact[];
  canReset: boolean;
}

export type SyncKind = 'degraded' | 'merge' | 'fetch' | 'push';

export interface SyncFact {
  kind: SyncKind;
  body: string;
  reason: string;
}

const precedence: SyncKind[] = ['degraded', 'merge', 'fetch', 'push'];

const titles: Record<SyncKind, string> = {
  degraded: 'Changes are not being recorded',
  merge: 'The remote version cannot be applied here',
  fetch: 'The remote cannot be reached',
  push: 'Changes are not reaching the remote',
};

export function syncMessage(me: MeResponse | undefined): SyncMessage | undefined {
  if (me === undefined) {
    return undefined;
  }
  const facts = factsOf(me);
  const first = facts[0];
  if (first === undefined) {
    return undefined;
  }
  const diverged = me.space.diverged && facts.some((entry) => entry.kind === 'merge');
  return {
    kind: first.kind,
    title: titleOf(first.kind, diverged, me.space.push_refused),
    facts,
    canReset: diverged && me.space.can_reset,
  };
}

function titleOf(kind: SyncKind, diverged: boolean, refused: boolean): string {
  if (kind === 'merge' && diverged) {
    return divergedTitle;
  }
  if (kind === 'push' && refused) {
    return refusedTitle;
  }
  return titles[kind];
}

function factsOf(me: MeResponse): SyncFact[] {
  const { space } = me;
  const stage = stageOf(space.sync_error);
  const affected = affectedSentence(me);

  const res: SyncFact[] = [];
  for (const kind of precedence) {
    if (kind === 'degraded') {
      if (me.history_degraded) {
        res.push({
          kind,
          body: 'A change reached the disk and history did not record it. The next save that succeeds folds it in.',
          reason: '',
        });
      }
      continue;
    }
    if (kind !== stage) {
      continue;
    }
    if (kind === 'merge' && space.diverged) {
      res.push({ kind, body: divergedBody(space.can_reset) + affected, reason: '' });
      continue;
    }
    if (kind === 'push' && space.push_refused) {
      res.push({ kind, body: refusedBody + affected, reason: '' });
      continue;
    }
    res.push({ kind, body: bodyOf(kind, space.unpublished) + affected, reason: space.sync_error });
  }
  return res;
}

const divergedTitle = 'This space has diverged from the remote';

function divergedBody(canReset: boolean): string {
  const what =
    'This copy and the remote both changed, and scrawl does not merge the two. ' +
    'Nothing is sent or received until this copy is reset to the remote version.';
  return canReset ? what : `${what} You are not allowed to do that here.`;
}

const refusedTitle = 'The remote does not take changes from this space';

const refusedBody =
  'This space has no token that may write to the remote, so changes stay in this copy. ' +
  'Give the space a token with write access, or make it read-only.';

function bodyOf(kind: SyncKind, unpublished: boolean): string {
  switch (kind) {
    case 'push':
      return (
        'The change is saved here and recorded in history, it has not reached the remote. ' +
        'The next save tries again.'
      );
    case 'fetch':
      return unpublished
        ? 'This copy may be behind the remote, and what was changed here has not reached it either.'
        : 'This copy may be behind the remote.';
    case 'merge':
      return 'The remote has changes this copy could not take in. The reason is below.';
    default:
      return '';
  }
}

function affectedSentence(me: MeResponse): string {
  const { unsynced } = me.space;
  if (unsynced.many) {
    return ' Many files are affected, too many to list.';
  }
  if (unsynced.paths.length > 0) {
    return ' Some notes are affected; the sync control lists them.';
  }
  return '';
}

function stageOf(syncError: string): SyncKind | undefined {
  for (const kind of ['merge', 'fetch', 'push'] as const) {
    if (syncError.startsWith(`${kind}:`)) {
      return kind;
    }
  }
  return undefined;
}
