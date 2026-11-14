import { useSyncExternalStore } from 'react';

import { changeSignal } from '../changeSignal';
import { localStore, readText, writeText } from '../storage';

const choiceKey = 'scrawl.offline';

const choiceChanged = changeSignal();

export function offlineSupported(): boolean {
  return window.isSecureContext && 'serviceWorker' in navigator && 'caches' in window && 'locks' in navigator;
}

function standalone(): boolean {
  const apple = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return apple || window.matchMedia('(display-mode: standalone)').matches;
}

export function offlineWanted(): boolean {
  if (!offlineSupported()) {
    return false;
  }
  const choice = readText(localStore(), choiceKey);
  return choice === undefined ? standalone() : choice === 'on';
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
