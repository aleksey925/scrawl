// The shell names both the node to mount on and the prefix it is served under.
// Taking the prefix from the document rather than baking it in is what lets one
// bundle serve /app while the old pages are still there and / once it replaces
// them, with no rebuild in between.
const MOUNT_ID = 'scrawl-app-root';

export function mountNode(): HTMLElement {
  const node = document.getElementById(MOUNT_ID);
  if (node === null) {
    throw new Error(`mount node #${MOUNT_ID} is missing from the shell`);
  }
  return node;
}

export function mountBase(): string {
  const base = document.getElementById(MOUNT_ID)?.dataset.base;
  return base === undefined || base === '' ? '/' : base;
}
