const running = new Set<Promise<unknown>>();

export function track(work: Promise<unknown>): void {
  running.add(work);
  const done = (): void => {
    running.delete(work);
  };
  void work.then(done, done);
}

export async function trackedDone(): Promise<void> {
  while (running.size > 0) {
    await Promise.allSettled(running);
  }
}
