import type { JSX } from 'react';

import { versionTime } from '../components/formats';

import classes from './Editor.module.css';

export interface DraftOfferProps {
  at: number;
  stale: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}

export function DraftOffer({ at, stale, onRestore, onDiscard }: DraftOfferProps): JSX.Element {
  return (
    <div data-testid="editor-draft" data-stale={stale ? 'true' : 'false'} className={classes.draftOffer}>
      <span className={classes.draftMark} aria-hidden="true" />
      <span className={classes.draftText}>
        <span className={classes.draftTitle}>Unsaved draft</span>
        <span data-testid="editor-draft-when" className={classes.draftWhen}>
          {stale ? `${versionTime(at)} · file changed` : versionTime(at)}
        </span>
      </span>
      <button type="button" data-testid="editor-draft-discard" className={classes.draftButton} onClick={onDiscard}>
        Discard
      </button>
      <button
        type="button"
        data-testid="editor-draft-restore"
        className={`${classes.draftButton} ${classes.draftRestore}`}
        onClick={onRestore}
      >
        Restore
      </button>
    </div>
  );
}
