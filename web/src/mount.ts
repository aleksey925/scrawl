const MOUNT_ID = 'scrawl-app-root';

export function mountNode(): HTMLElement {
  const node = document.getElementById(MOUNT_ID);
  if (node === null) {
    throw new Error(`mount node #${MOUNT_ID} is missing from the shell`);
  }
  return node;
}

export function mountBase(): string {
  const base = document.getElementById(MOUNT_ID)?.dataset.base ?? '';
  return base === '/' ? '' : base.replace(/\/+$/, '');
}
