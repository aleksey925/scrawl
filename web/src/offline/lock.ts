import { post } from './channel';

const lockName = 'scrawl-offline-copy';

export function tryCopyLock(run: () => Promise<void>): Promise<void> {
  return navigator.locks.request(lockName, { ifAvailable: true }, async (lock) => {
    if (lock !== null) {
      await run();
    }
  });
}

export function underCopyLock(run: () => Promise<void>): Promise<void> {
  post({ type: 'abort' });
  return navigator.locks.request(lockName, run);
}
