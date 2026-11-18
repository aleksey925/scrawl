export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function motionMs(ms: number): number {
  return reducedMotion() ? 0 : ms;
}

let entering: Animation | undefined;

export function noteEntering(animation: Animation): void {
  entering = animation;
}

export function screenSettled(): Promise<void> {
  const running = entering;
  return running === undefined || running.playState === 'finished' || running.playState === 'idle'
    ? Promise.resolve()
    : running.finished.then(
        () => undefined,
        () => undefined,
      );
}
