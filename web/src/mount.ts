// The shell names both the node to mount on and the project prefix it is served
// under. Taking the prefix from the document rather than baking it in is what
// lets one bundle serve every project.
const MOUNT_ID = 'scrawl-app-root';

export function mountNode(): HTMLElement {
  const node = document.getElementById(MOUNT_ID);
  if (node === null) {
    throw new Error(`mount node #${MOUNT_ID} is missing from the shell`);
  }
  return node;
}

// mountBase is the project prefix, "/p/notes", with no trailing slash. That is
// the whole contract: a physical url is mountBase() + path, and a path always
// begins with a slash, so nothing ever concatenates a bare segment onto it.
// "/" and an absent attribute both mean no prefix and answer with the empty
// string, which keeps that one rule true for them too.
export function mountBase(): string {
  const base = document.getElementById(MOUNT_ID)?.dataset.base ?? '';
  return base === '/' ? '' : base.replace(/\/+$/, '');
}
