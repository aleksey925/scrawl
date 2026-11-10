import { post } from './channel';
import { dataCache } from './keys';
import { underCopyLock } from './lock';
import { offlineSupported, offlineWanted } from './preference';
import { readState, writeState } from './records';

const signInCookie = 'scrawl_signin';

function signedInAs(): string | undefined {
  for (const part of document.cookie.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === signInCookie) {
      return decodeURIComponent(value.join('=').replace(/\+/g, ' '));
    }
  }
  return undefined;
}

function dropSignInCookie(): void {
  document.cookie = `${signInCookie}=; Path=/; Max-Age=0`;
}

export async function takeOwnership(owner: string): Promise<void> {
  const state = await readState();
  if (state?.owner === owner) {
    return;
  }
  await caches.delete(dataCache);
  await writeState(await caches.open(dataCache), { owner, updatedAt: 0, error: '' });
  post({ type: 'owner' });
}

async function checkOwner(): Promise<void> {
  const user = signedInAs();
  if (user === undefined) {
    return;
  }
  if (!offlineWanted()) {
    dropSignInCookie();
    return;
  }
  try {
    await underCopyLock(() => takeOwnership(user));
  } finally {
    dropSignInCookie();
  }
}

export const ownerChecked: Promise<void> = offlineSupported() ? checkOwner().catch(() => undefined) : Promise.resolve();
