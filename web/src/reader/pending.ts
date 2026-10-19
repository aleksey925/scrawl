const running = new Set<Promise<unknown>>();

// track records a pass that changes how the note reads - a diagram drawn, a
// formula typeset - so that a print can wait for it
export function track(work: Promise<unknown>): void {
  running.add(work);
  const done = (): void => {
    running.delete(work);
  };
  void work.then(done, done);
}

// trackedDone resolves once no tracked pass is running, one started while it
// waits included
export async function trackedDone(): Promise<void> {
  while (running.size > 0) {
    await Promise.allSettled(running);
  }
}
