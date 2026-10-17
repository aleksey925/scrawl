import { useRef, type JSX } from 'react';

import classes from './Editor.module.css';

export interface SplitterProps {
  onDrag: (clientX: number) => void;
  onNudge: (direction: -1 | 1) => void;
}

export function Splitter({ onDrag, onNudge }: SplitterProps): JSX.Element {
  const self = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const stop = (event: React.PointerEvent<HTMLDivElement>): void => {
    dragging.current = false;
    if (self.current?.hasPointerCapture(event.pointerId) === true) {
      self.current.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={self}
      data-testid="editor-splitter"
      className={classes.splitter}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the editor and preview panes"
      tabIndex={0}
      onPointerDown={(event) => {
        dragging.current = true;
        self.current?.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (dragging.current) {
          onDrag(event.clientX);
        }
      }}
      onPointerUp={stop}
      // the browser can claim the gesture, and then no pointerup ever arrives
      // and the splitter stays stuck to the pointer
      onPointerCancel={stop}
      onLostPointerCapture={() => {
        dragging.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          onNudge(-1);
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          onNudge(1);
        }
      }}
    />
  );
}
