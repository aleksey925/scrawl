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
  reason: string;
}

const precedence: SyncKind[] = ['degraded', 'merge', 'fetch', 'push'];

const titles: Record<SyncKind, string> = {
  degraded: 'Changes are not being recorded',
  merge: 'The remote version cannot be applied here',
  fetch: 'The remote cannot be reached',
  push: 'Changes have not reached the remote yet',
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
    if (kind === 'merge' && space.diverged) {
      res.push({ kind, body: divergedBody(space.can_reset) + affected, reason: '' });
      continue;
    }
    if (kind !== stage) {
      continue;
    }
    const refusal = space.push_refused ? refusals[kind] : undefined;
    if (refusal !== undefined) {
      res.push({ kind, body: refusal.body + affected, reason: refusal.withReason ? space.sync_error : '' });
      continue;
    }
    res.push({ kind, body: bodyOf(kind, space) + retryOf(kind, space.retrying) + affected, reason: space.sync_error });
  }
  return res;
}

const divergedTitle = 'This space has a conflict with the remote';

function divergedBody(canReset: boolean): string {
  const what =
    'This copy and the remote both have changes the other does not, and scrawl does not merge them. ' +
    'Nothing is sent or received until this copy is reset to the remote version.';
  return canReset ? what : `${what} You are not allowed to do that here.`;
}

interface Refusal {
  title: string;
  body: string;
  withReason: boolean;
}

const refusals: Partial<Record<SyncKind, Refusal>> = {
  push: {
    title: 'The remote does not take changes from this space',
    body:
      'This space has no token that may write to the remote, so changes stay in this copy. ' +
      'Give the space a token with write access, or make it read-only.',
    withReason: false,
  },
  fetch: {
    title: 'The remote refuses this space',
    body:
      'The remote does not accept the token of this space, so nothing is sent or received. ' +
      'Give the space a token that may read the remote, and write to it unless the space is read-only.',
    withReason: true,
  },
};

function retryOf(kind: SyncKind, retrying: boolean): string {
  if (retrying) {
    return ' scrawl tries again in about a minute.';
  }
  return kind === 'push' ? ' The next save tries again.' : '';
}

function bodyOf(kind: SyncKind, space: SpaceState): string {
  switch (kind) {
    case 'push':
      return 'The change is saved here and recorded in history, but it has not reached the remote yet.';
    case 'fetch':
      return space.unpublished
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
    return { state: 'sending', name: 'Sending changes', detail: 'Sending changes to the remote.' };
  }
  if (space.unpublished) {
    return { state: 'not-sent', name: space.retrying ? 'Not sent, will retry' : 'Not sent' };
  }
  if (sync !== undefined) {
    return { state: 'warning', name: 'Not synced' };
  }
  if (space.kind === 'remote' && !space.read_only) {
    return {
      state: 'sent',
      name: 'All changes sent',
      detail: 'All changes sent. Everything saved here is on the remote too.',
    };
  }
  return undefined;
}
