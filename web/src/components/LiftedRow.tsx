import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import classes from './LiftedRow.module.css';
import { motionMs, springEasing } from './screenMotion';

const liftMs = 220;
const dropMs = 160;
const liftScale = 1.03;
const cardBleed = 8;

export interface LiftedRowProps {
  rect: DOMRect;
  children: ReactNode;
  menu: (mark: ReactElement, opened: boolean, setOpened: (opened: boolean) => void) => ReactNode;
  onDropped: () => void;
}

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
