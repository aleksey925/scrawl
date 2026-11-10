const MOUNT_ID = 'scrawl-app-root';

export function mountNode(): HTMLElement {
  const node = document.getElementById(MOUNT_ID);
  if (node === null) {
    throw new Error(`mount node #${MOUNT_ID} is missing from the shell`);
  }
  return node;
}

export function servedOffline(): boolean {
  return document.getElementById(MOUNT_ID)?.dataset.base === '';
}

export function mountBase(): string {
  const base = document.getElementById(MOUNT_ID)?.dataset.base;
  if (base === undefined) {
    return '';
  }
  if (base === '') {
    return /^\/s\/[^/]+/.exec(window.location.pathname)?.[0] ?? '';
  }
  return base === '/' ? '' : base.replace(/\/+$/, '');
}

export function mountRelease(): string {
  return document.getElementById(MOUNT_ID)?.dataset.version ?? '';
}
