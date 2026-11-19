const idleWaitMs = 300;

export function whenIdle(task: () => void): void {
  const later = (): void => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(task);
    } else {
      setTimeout(task, idleWaitMs);
    }
  };
  if (document.readyState === 'complete') {
    later();
  } else {
    window.addEventListener('load', later, { once: true });
  }
}
