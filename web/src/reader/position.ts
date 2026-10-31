const stabiliseDelaysMs: readonly number[] = [0, 60, 180, 400, 800];

export const interactionEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

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
