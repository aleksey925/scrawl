import { onMessage, post } from './channel';
import { startConnection } from './connection';
import { copyNow, startCopy, stopCopy } from './copy';
import { appCachePrefix, dataCache, fillAppMessage } from './keys';
import { underCopyLock } from './lock';
import { choiceChangedElsewhere, offlineSupported, offlineWanted, setOfflineChoice } from './preference';
import { appFailed, forgetStatus, refreshStatus, startStatus } from './status';

let switching: Promise<void> = Promise.resolve();

function afterSwitching(task: () => Promise<void>): Promise<void> {
  const next = switching.then(task);
  switching = next.catch(() => undefined);
  return next;
}

async function registerWorker(): Promise<void> {
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
    appFailed();
    throw error;
  });
  await registration.update().catch(() => undefined);
  if (offlineWanted()) {
    registration.active?.postMessage(fillAppMessage);
  }
}

async function unregisterWorkers(): Promise<void> {
  const registered = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registered.map((registration) => registration.unregister()));
}

async function deleteEveryCache(): Promise<void> {
  await Promise.all(
    (await caches.keys()).filter((name) => name === dataCache || name.startsWith(appCachePrefix)).map((name) => caches.delete(name)),
  );
}

export function turnOfflineOn(): Promise<void> {
  setOfflineChoice(true);
  void navigator.storage.persist?.();
  post({ type: 'choice' });
  return afterSwitching(async () => {
    copyNow();
    await registerWorker();
  });
}

export function turnOfflineOff(): Promise<void> {
  setOfflineChoice(false);
  post({ type: 'choice' });
  return afterSwitching(async () => {
    stopCopy();
    await underCopyLock(async () => {
      await deleteEveryCache();
      await unregisterWorkers();
    });
    forgetStatus();
  });
}

export async function deleteOfflineData(): Promise<void> {
  if (!offlineSupported()) {
    return;
  }
  stopCopy();
  await underCopyLock(async () => {
    await caches.delete(dataCache);
  });
  forgetStatus();
}

export function startOffline(): void {
  if (!offlineSupported()) {
    return;
  }
  startConnection();
  startStatus();
  startCopy();
  onMessage((message) => {
    if (message.type === 'choice') {
      choiceChangedElsewhere();
      void refreshStatus();
      if (offlineWanted()) {
        copyNow();
      }
    }
  });
  if (offlineWanted()) {
    void afterSwitching(registerWorker).catch(() => undefined);
  }
}
