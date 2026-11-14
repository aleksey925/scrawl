import { post } from './channel';
import { dataCache, secureSignInCookie, signInCookie, signInCookies } from './keys';
import { underCopyLock } from './lock';
import { offlineSupported, offlineWanted } from './preference';
import { readState, writeState } from './records';

function cookieValue(wanted: string): string | undefined {
  for (const part of document.cookie.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === wanted) {
      return decodeURIComponent(value.join('=').replace(/\+/g, ' '));
    }
  }
  return undefined;
}

function signedInAs(): string | undefined {
  for (const name of signInCookies) {
    const user = cookieValue(name);
    if (user !== undefined) {
      return user;
    }
  }
  return undefined;
}

function dropSignInCookies(): void {
  document.cookie = `${secureSignInCookie}=; Path=/; Max-Age=0; Secure`;
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
  try {
    if (offlineWanted() || (await caches.has(dataCache))) {
      await underCopyLock(() => takeOwnership(user));
    }
  } finally {
    dropSignInCookies();
  }
}

export const ownerChecked: Promise<void> = offlineSupported() ? checkOwner().catch(() => undefined) : Promise.resolve();
