import type { JSX, ReactNode } from 'react';

import classes from './NoteCard.module.css';
import { PageCard } from './PageCard';

export interface NoteCardProps {
  header?: ReactNode;
  children: ReactNode;
}

// NoteCard is the surface a note is read on, set off from the ground the rest
// of the page stands on
export function NoteCard({ header, children }: NoteCardProps): JSX.Element {
  return (
    <PageCard header={header} wide className={classes.card}>
      <div className={classes.body}>{children}</div>
    </PageCard>
  );
}
