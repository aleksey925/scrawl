export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function motionMs(ms: number): number {
  return reducedMotion() ? 0 : ms;
}
