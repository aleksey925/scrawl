import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import card from '../card.module.css';
import { layout } from '../theme';

import { useStuck } from './useStuck';

// the line a card's head sticks to: under the topbar, a gap and the card's
// top edge below it
const stickLine = layout.topbarHeight + layout.railGutter + 1;

export interface PageCardProps extends ComponentPropsWithoutRef<'div'> {
  // a strip at the top, the path or what the card lists; one that renders
  // nothing takes no room
  header?: ReactNode;
  // in the column of a note, with the note's inset
  wide?: boolean;
}

// PageCard is a block on the page: a note, a folder, a list of results or
// versions, each with its head in the card rather than above it
export function PageCard({ header, wide = false, className, children, ...rest }: PageCardProps): JSX.Element {
  const classes = [card.pageCard, wide ? card.wide : '', className ?? ''].filter((name) => name !== '');
  const [marker, stuck] = useStuck(stickLine);
  return (
    <div {...rest} className={classes.join(' ')}>
      {header !== undefined && (
        <>
          <div ref={marker} aria-hidden />
          <div className={card.headBar} data-stuck={stuck ? 'true' : 'false'} data-print="hide">
            <div className={card.head}>{header}</div>
          </div>
        </>
      )}
      {children}
    </div>
  );
}
