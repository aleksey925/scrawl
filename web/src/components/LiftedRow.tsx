import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import classes from './LiftedRow.module.css';
import { motionMs, springEasing } from './screenMotion';

const liftMs = 220;
const dropMs = 160;
// the card stands a little proud of the row it was, as iOS shows a lifted row
const liftScale = 1.03;
// the card reaches past the row by this much a side, into the page's gutter
const cardBleed = 8;

export interface LiftedRowProps {
  // where the row stood when the finger lifted it
  rect: DOMRect;
  children: ReactNode;
  // menu draws the row's menu opening from the mark it is given, a line down
  // the row's right edge
  menu: (mark: ReactElement, opened: boolean, setOpened: (opened: boolean) => void) => ReactNode;
  // onDropped runs once the card has gone back into the row
  onDropped: () => void;
}

// LiftedRow raises a copy of a row over the page and opens the row's menu from
// it; closing the menu sets the row back down
export function LiftedRow({ rect, children, menu, onDropped }: LiftedRowProps): JSX.Element {
  const [opened, setOpened] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    cardRef.current?.animate([{ transform: 'scale(1)', boxShadow: 'none' }, { transform: `scale(${liftScale})` }], {
      duration: motionMs(liftMs),
      easing: springEasing,
      fill: 'forwards',
    });
    backdropRef.current?.animate([{ opacity: 0 }, {}], { duration: motionMs(liftMs), easing: 'ease-out' });
  }, []);

  useEffect(() => {
    if (opened) {
      return;
    }
    const options = { duration: motionMs(dropMs), easing: 'ease-in', fill: 'forwards' as const };
    backdropRef.current?.animate([{}, { opacity: 0 }], options);
    const drop = cardRef.current?.animate([{ transform: `scale(${liftScale})` }, { transform: 'scale(1)', boxShadow: 'none' }], options);
    if (drop === undefined) {
      onDropped();
      return;
    }
    void drop.finished.then(onDropped, onDropped);
  }, [opened]);

  const card = (
    <div
      ref={cardRef}
      data-testid="row-lift"
      className={classes.card}
      style={{
        top: rect.top,
        left: rect.left - cardBleed,
        width: rect.width + 2 * cardBleed,
        height: rect.height,
        paddingInline: cardBleed,
      }}
    >
      {children}
    </div>
  );
  // beside the card and not in it: the card is scaled, and a fixed element in a
  // scaled one is placed in it, which would shrink the menu's tap guard to the card
  const mark = <span className={classes.mark} style={{ top: rect.top, left: rect.right - 1, height: rect.height }} />;

  return createPortal(
    <div className={classes.layer}>
      <div ref={backdropRef} className={classes.backdrop} />
      {card}
      {menu(mark, opened, setOpened)}
    </div>,
    document.body,
  );
}
