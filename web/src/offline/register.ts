import { onMessage, post } from './channel';
import { startConnection } from './connection';
import { copyNow, startCopy, stopCopy } from './copy';
import { appCachePrefix, dataCache, fillAppMessage } from './keys';
import { underCopyLock } from './lock';
import { choiceChangedElsewhere, offlineSupported, offlineWanted, setOfflineChoice } from './preference';
import { forgetStatus, refreshStatus, startStatus } from './status';

async function registerWorker(): Promise<void> {
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
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

export async function turnOfflineOn(): Promise<void> {
  setOfflineChoice(true);
  void navigator.storage.persist?.();
  post({ type: 'choice' });
  copyNow();
  await registerWorker();
}

export async function turnOfflineOff(): Promise<void> {
  setOfflineChoice(false);
  post({ type: 'choice' });
  stopCopy();
  await underCopyLock(async () => {
    await deleteEveryCache();
    await unregisterWorkers();
  });
  forgetStatus();
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
    void registerWorker().catch(() => undefined);
  }
}
