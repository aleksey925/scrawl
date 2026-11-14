import { htmlappCache, workerScript, type WorkerMessage } from './protocol';

const waitMs = 3_000;

const { file = '/', parent = '', offline: offlineFlag } = document.body.dataset;

function within(work: Promise<unknown>): Promise<void> {
  return Promise.race([
    work.then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
  ]);
}

function scriptOf(worker: ServiceWorker): string {
  return new URL(worker.scriptURL).pathname;
}

function workersOf(registration: ServiceWorkerRegistration): ServiceWorker[] {
  return [registration.installing, registration.waiting, registration.active].filter((worker) => worker !== null);
}

function ownedByApp(registration: ServiceWorkerRegistration | undefined): boolean {
  return registration !== undefined && workersOf(registration).some((worker) => scriptOf(worker) !== workerScript);
}

async function rootRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return registration?.scope === `${location.origin}/` ? registration : undefined;
}

function whenActive(registration: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  const pending = registration.installing ?? registration.waiting;
  if (pending === null) {
    return Promise.resolve(registration.active);
  }
  return new Promise((resolve) => {
    pending.addEventListener('statechange', () => {
      if (pending.state === 'activated') {
        resolve(pending);
      } else if (pending.state === 'redundant') {
        resolve(registration.active);
      }
    });
  });
}

function ask(worker: ServiceWorker, message: WorkerMessage): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    worker.postMessage(message, [channel.port2]);
  });
}

async function keep(): Promise<void> {
  if (ownedByApp(await rootRegistration())) {
    return;
  }
  const registration = await navigator.serviceWorker.register(workerScript, { scope: '/' });
  const worker = await whenActive(registration);
  if (worker !== null) {
    await ask(worker, { type: 'refresh', parent });
  }
}

async function stop(): Promise<void> {
  const registration = await rootRegistration();
  const active = registration?.active ?? null;
  if (active !== null && scriptOf(active) === workerScript) {
    await within(ask(active, { type: 'off' }));
  }
  if (registration !== undefined && !ownedByApp(registration)) {
    await registration.unregister();
  }
}

async function prepare(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) {
    return false;
  }
  if (offlineFlag === 'true') {
    await within(keep());
  } else {
    await stop();
    await caches.delete(htmlappCache);
  }
  return ((await rootRegistration())?.active ?? null) !== null;
}

function tellParent(offline: boolean): void {
  if (window.parent === window || parent === '') {
    return;
  }
  try {
    window.parent.postMessage({ type: 'scrawl-htmlapp', offline }, parent);
  } catch {
  }
}

void prepare()
  .catch(() => false)
  .then((offline) => {
    tellParent(offline);
    location.replace(file);
  });
