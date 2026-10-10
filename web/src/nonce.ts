import { setNonce } from 'get-nonce';

const metaName = 'csp-nonce';

let resolved: string | undefined;
let resolvedOnce = false;

export function styleNonce(): string | undefined {
  if (!resolvedOnce) {
    resolvedOnce = true;
    const meta = document.querySelector(`meta[name="${metaName}"]`);
    const value = meta instanceof HTMLMetaElement ? meta.content.trim() : '';
    resolved = value === '' ? undefined : value;
  }
  return resolved;
}

// react-remove-scroll, behind Drawer and the modals, reads its nonce from the
// get-nonce package rather than from MantineProvider, so it has to be told too
export function installStyleNonce(): string | undefined {
  const nonce = styleNonce();
  if (nonce !== undefined) {
    setNonce(nonce);
  }
  return nonce;
}
