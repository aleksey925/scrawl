import type { MeResponse } from '../api/types';

// SyncMessage is what the project has to say about itself, in the one place it
// is written. The banner and the sync control render the same value, so they
// can never drift apart.
export interface SyncMessage {
  // the state that supplies the title, which is all precedence decides
  kind: SyncKind;
  title: string;
  // one paragraph per active fact, in precedence order. At most two states are
  // true at once, one from each family, so this is at most two entries.
  facts: SyncFact[];
}

export type SyncKind = 'degraded' | 'merge' | 'fetch' | 'push';

export interface SyncFact {
  kind: SyncKind;
  body: string;
  // the redacted git reason, empty for the degraded state, which has none
  reason: string;
}

// degraded wins a title because it is the only state where the change has no
// record at all, not merely unpushed. merge comes next because it is the only
// remote state that will never fix itself. fetch outranks push because an
// unreachable remote explains a failed push and a failed push does not explain
// an unreachable remote.
const precedence: SyncKind[] = ['degraded', 'merge', 'fetch', 'push'];

const titles: Record<SyncKind, string> = {
  degraded: 'Changes are not being recorded',
  merge: 'This project has diverged from the remote',
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
  return { kind: first.kind, title: titles[first.kind], facts };
}

function factsOf(me: MeResponse): SyncFact[] {
  const { project } = me;
  const stage = stageOf(project.sync_error);
  const affected = affectedSentence(me);

  const res: SyncFact[] = [];
  for (const kind of precedence) {
    if (kind === 'degraded') {
      if (me.history_degraded) {
        res.push({
          kind,
          // no affected sentence: degraded says nothing about which paths the
          // remote is missing
          body: 'A change reached the disk and history did not record it. The next save that succeeds folds it in.',
          reason: '',
        });
      }
      continue;
    }
    if (kind !== stage) {
      continue;
    }
    res.push({ kind, body: bodyOf(kind, project.unpublished) + affected, reason: project.sync_error });
  }
  return res;
}

function bodyOf(kind: SyncKind, unpublished: boolean): string {
  switch (kind) {
    case 'push':
      return (
        'The change is saved here and recorded in history, it has not reached the remote. ' +
        // true with no ticker and no webhook, because the push runs inside the
        // save itself
        'The next save tries again.'
      );
    case 'fetch':
      return unpublished
        ? 'This copy may be behind the remote, and what was changed here has not reached it either.'
        : 'This copy may be behind the remote.';
    case 'merge':
      return 'scrawl never merges by hand. Nothing more will reach the remote until this is resolved in the clone.';
    default:
      return '';
  }
}

// affectedSentence is the only place "some notes" and "many files" are written,
// and it never carries a count: an exact number costs the whole diff and buys a
// digit nobody acts on.
function affectedSentence(me: MeResponse): string {
  const { unsynced } = me.project;
  if (unsynced.many) {
    return ' Many files are affected, too many to list.';
  }
  if (unsynced.paths.length > 0) {
    return ' Some notes are affected; the sync control lists them.';
  }
  return '';
}

// stageOf reads the stage word Sync puts at the front of its error. Sync
// returns the first error it hit, so at most one stage is current at any
// moment, which is what makes the remote states mutually exclusive.
function stageOf(syncError: string): SyncKind | undefined {
  for (const kind of ['merge', 'fetch', 'push'] as const) {
    if (syncError.startsWith(`${kind}:`)) {
      return kind;
    }
  }
  return undefined;
}
