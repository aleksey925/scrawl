export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function motionMs(ms: number): number {
  return reducedMotion() ? 0 : ms;
}

let entering: Promise<void> | undefined;

export function noteEntering(settled: Promise<void>): void {
  entering = settled;
}

export function screenSettled(): Promise<void> {
  return entering ?? Promise.resolve();
}
