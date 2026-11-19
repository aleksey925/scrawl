import { useSyncExternalStore } from 'react';

import { changeSignal } from '../changeSignal';
import { iosHomeScreenApp } from '../homeScreen';
import { localStore, readText, writeText } from '../storage';

const choiceKey = 'scrawl.offline';

const choiceChanged = changeSignal();

export function offlineSupported(): boolean {
  return window.isSecureContext && 'serviceWorker' in navigator && 'caches' in window && 'locks' in navigator;
}

function installedApp(): boolean {
  return iosHomeScreenApp() || window.matchMedia('(display-mode: standalone)').matches;
}

export function offlineWanted(): boolean {
  if (!offlineSupported()) {
    return false;
  }
  const choice = readText(localStore(), choiceKey);
  return choice === undefined ? installedApp() : choice === 'on';
}

export function setOfflineChoice(on: boolean): void {
  writeText(localStore(), choiceKey, on ? 'on' : 'off');
  choiceChanged.notify();
}

export function choiceChangedElsewhere(): void {
  choiceChanged.notify();
}

export function onChoiceChange(listener: () => void): () => void {
  return choiceChanged.subscribe(listener);
}

export function useOfflineWanted(): boolean {
  return useSyncExternalStore(choiceChanged.subscribe, offlineWanted);
}
