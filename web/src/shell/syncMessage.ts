import type { MeResponse, SpaceState } from '../api/types';

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
  affected: string;
  reason: string;
}

export function factText(entry: SyncFact, listed: boolean): string {
  return listed || entry.affected === '' ? entry.body : `${entry.body} ${entry.affected}`;
}

const precedence: SyncKind[] = ['degraded', 'merge', 'fetch', 'push'];

const titles: Record<SyncKind, string> = {
  degraded: 'History is not recording',
  merge: 'Not synced',
  fetch: 'No connection to the remote',
  push: 'Not sent to the remote yet',
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
  const { diverged, push_refused: refused, can_reset: canReset } = me.space;
  return {
    kind: first.kind,
    title: titleOf(first.kind, diverged, refused),
    facts,
    canReset: diverged && canReset,
  };
}

function titleOf(kind: SyncKind, diverged: boolean, refused: boolean): string {
  if (kind === 'merge' && diverged) {
    return divergedTitle;
  }
  const refusal = refused ? refusals[kind] : undefined;
  return refusal?.title ?? titles[kind];
}

function factsOf(me: MeResponse): SyncFact[] {
  const { space } = me;
  const stage = stageOf(space.sync_error);

  const res: SyncFact[] = [];
  for (const kind of precedence) {
    if (kind === 'degraded') {
      if (me.history_degraded) {
        res.push({
          kind,
          body: 'A change was saved but not recorded in history. The next save records it.',
          affected: '',
          reason: '',
        });
      }
      continue;
    }
    if (kind === 'merge' && space.diverged) {
      res.push({ kind, body: divergedBody(space.can_reset), affected: affectedSentence(me, true), reason: '' });
      continue;
    }
    if (kind !== stage) {
      continue;
    }
    const refusal = space.push_refused ? refusals[kind] : undefined;
    const affected = affectedSentence(me, false);
    if (refusal !== undefined) {
      res.push({ kind, body: refusal.body, affected, reason: refusal.withReason ? space.sync_error : '' });
      continue;
    }
    res.push({ kind, body: bodyOf(kind, space) + retryOf(kind, space.retrying), affected, reason: space.sync_error });
  }
  return res;
}

const divergedTitle = 'Conflict with the remote repository';

function divergedBody(canReset: boolean): string {
  const what = 'The local copy no longer matches the remote repository, so sync is paused.';
  return canReset ? what : `${what} Someone who can write to this space can fix it.`;
}

interface Refusal {
  title: string;
  body: string;
  withReason: boolean;
}

const refusals: Partial<Record<SyncKind, Refusal>> = {
  push: {
    title: 'The remote refuses changes',
    body: 'The token cannot write, so changes stay here. Use a token with write access, or make the space read-only.',
    withReason: false,
  },
  fetch: {
    title: 'The remote refuses the token',
    body:
      'Nothing is sent or received. ' +
      'Use a token that can read the remote, and write too unless the space is read-only.',
    withReason: true,
  },
};

function retryOf(kind: SyncKind, retrying: boolean): string {
  if (retrying) {
    return ' Retrying in a minute.';
  }
  return kind === 'push' ? ' The next save will try again.' : '';
}

function bodyOf(kind: SyncKind, space: SpaceState): string {
  switch (kind) {
    case 'push':
      return 'Saved here, but not sent yet.';
    case 'fetch':
      return space.unpublished
        ? 'No connection to the remote. Changes from it may be missing here, and changes from here are not sent.'
        : 'No connection to the remote. Changes from it may be missing here.';
    case 'merge':
      return 'Cannot take changes from the remote. The reason is below.';
    default:
      return '';
  }
}

function affectedSentence(me: MeResponse, conflict: boolean): string {
  const { unsynced } = me.space;
  if (unsynced.many) {
    return 'Too many files to list.';
  }
  if (unsynced.paths.length > 0) {
    return conflict
      ? 'Click the sync status at the top to see the conflicting files.'
      : 'To see the changes that were not synced, click the sync status at the top.';
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

export interface SyncStatus {
  state: 'blocked' | 'sending' | 'not-sent' | 'warning' | 'sent';
  name: string;
  detail?: string;
}

export function syncStatusOf(me: MeResponse | undefined, sync: SyncMessage | undefined): SyncStatus | undefined {
  if (me === undefined) {
    return undefined;
  }
  const { space } = me;
  if (space.diverged) {
    return { state: 'blocked', name: 'Conflict' };
  }
  if (space.push_refused) {
    return { state: 'blocked', name: 'Access refused' };
  }
  if (space.pushing) {
    return { state: 'sending', name: 'Syncing…', detail: 'Sending changes to the remote.' };
  }
  const name = stageOf(space.sync_error) === 'fetch' ? 'No connection' : 'Not synced';
  if (space.unpublished) {
    return { state: 'not-sent', name };
  }
  if (sync !== undefined) {
    return { state: 'warning', name };
  }
  if (space.kind === 'remote' && !space.read_only) {
    return {
      state: 'sent',
      name: 'Synced',
      detail: 'Everything is on the remote.',
    };
  }
  return undefined;
}
