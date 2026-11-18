export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function motionMs(ms: number): number {
  return reducedMotion() ? 0 : ms;
}

let entering: Promise<void> | undefined;

let held: { released: Promise<void> } | undefined;

export function noteEntering(settled: Promise<void>): void {
  entering = settled;
}

export function holdScreen(): () => void {
  let resolve = (): void => {};
  const hold = {
    released: new Promise<void>((done) => {
      resolve = done;
    }),
  };
  held = hold;
  return () => {
    if (held === hold) {
      held = undefined;
    }
    resolve();
  };
}

export async function screenSettled(): Promise<void> {
  await entering;
  while (held !== undefined) {
    await held.released;
  }
}
