import { useCallback, useState } from 'react';

import { layoutBreakpoints, useAtLeast } from '../theme';

import { modeKey, splitDefault, splitKey, splitMax, splitMin } from './constants';
import { localStore, readText, writeText } from './storage';

export type LayoutMode = 'source' | 'split' | 'preview';

export interface LayoutControl {
  mode: LayoutMode;
  chosen: LayoutMode;
  choose: (mode: LayoutMode) => void;
  split: number;
  setSplit: (fraction: number) => void;
  wide: boolean;
}

function isMode(value: string | undefined): value is LayoutMode {
  return value === 'source' || value === 'split' || value === 'preview';
}

function storedSplit(): number {
  const raw = Number.parseFloat(readText(localStore(), splitKey) ?? '');
  return Number.isNaN(raw) ? splitDefault : Math.min(splitMax, Math.max(splitMin, raw));
}

export function useEditorLayout(): LayoutControl {
  const wide = useAtLeast(layoutBreakpoints.editorSplit);

  const [chosen, setChosen] = useState<LayoutMode>(() => {
    const stored = readText(localStore(), modeKey);
    // only an explicit choice is ever read back. The boot default is derived
    // from the width, and storing that turns one edit on a phone into a desktop
    // that quietly lost its split view.
    return isMode(stored) ? stored : wide ? 'split' : 'source';
  });
  const [split, setSplitState] = useState<number>(storedSplit);

  const choose = useCallback((next: LayoutMode): void => {
    setChosen(next);
    writeText(localStore(), modeKey, next);
  }, []);

  const setSplit = useCallback((fraction: number): void => {
    const clamped = Math.min(splitMax, Math.max(splitMin, fraction));
    setSplitState(clamped);
    writeText(localStore(), splitKey, String(clamped));
  }, []);

  const mode: LayoutMode = wide ? chosen : chosen === 'preview' ? 'preview' : 'source';

  return { mode, chosen, choose, split, setSplit, wide };
}
