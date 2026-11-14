import { localStore, readJson, writeJson } from '../storage';

import { post } from './channel';
import { dataCache, secureSignInCookie, signInCookie } from './keys';
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

const secureSignInSeenKey = 'scrawl-secure-sign-in';

function signedInAs(): string | undefined {
  const secure = cookieValue(secureSignInCookie);
  if (secure !== undefined) {
    writeJson(localStore(), secureSignInSeenKey, true);
    return secure;
  }
  return readJson<boolean>(localStore(), secureSignInSeenKey) === true ? undefined : cookieValue(signInCookie);
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
