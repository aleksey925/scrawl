// late images, fonts, math and diagrams move the document after mount, so a
// position is re-applied across a short window instead of once
const stabiliseDelaysMs: readonly number[] = [0, 60, 180, 400, 800];

// what a reader does to move a document themselves, as opposed to what the app
// does to it. A scroll event is not among them: it says the element moved, not
// who moved it, which is the whole difficulty these two uses share.
export const interactionEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

// the position is re-applied until the document stops moving under it, and any
// deliberate move by the reader ends that immediately
export function holdPosition(apply: () => void, watched: EventTarget): () => void {
  let stopped = false;
  const timers: number[] = [];

  const stop = (): void => {
    stopped = true;
    for (const timer of timers) {
      window.clearTimeout(timer);
    }
    for (const name of interactionEvents) {
      watched.removeEventListener(name, stop);
    }
  };

  for (const name of interactionEvents) {
    watched.addEventListener(name, stop, { passive: true });
  }
  for (const delay of stabiliseDelaysMs) {
    timers.push(
      window.setTimeout(() => {
        if (!stopped) {
          apply();
        }
      }, delay),
    );
  }
  return stop;
}
