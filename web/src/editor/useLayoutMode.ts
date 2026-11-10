import { useCallback, useState } from 'react';

import { localStore, readText, writeText } from '../storage';
import { layoutBreakpoints, useAtLeast } from '../theme';

import { modeKey, splitDefault, splitKey, splitMax, splitMin } from './constants';

export type LayoutMode = 'source' | 'split' | 'preview' | 'changes';

type StoredMode = Exclude<LayoutMode, 'changes'>;

export interface LayoutControl {
  mode: LayoutMode;
  chosen: LayoutMode;
  choose: (mode: LayoutMode) => void;
  split: number;
  setSplit: (fraction: number) => void;
  wide: boolean;
}

function isStoredMode(value: string | null | undefined): value is StoredMode {
  return value === 'source' || value === 'split' || value === 'preview';
}

export function isLayoutMode(value: string | null): value is LayoutMode {
  return isStoredMode(value) || value === 'changes';
}

function storedSplit(): number {
  const raw = Number.parseFloat(readText(localStore(), splitKey) ?? '');
  return Number.isNaN(raw) ? splitDefault : Math.min(splitMax, Math.max(splitMin, raw));
}

export function useEditorLayout(): LayoutControl {
  const wide = useAtLeast(layoutBreakpoints.editorSplit);

  const [chosen, setChosen] = useState<LayoutMode>(() => {
    const stored = readText(localStore(), modeKey);
    return isStoredMode(stored) ? stored : wide ? 'split' : 'source';
  });
  const [split, setSplitState] = useState<number>(storedSplit);

  const choose = useCallback((next: LayoutMode): void => {
    setChosen(next);
    if (isStoredMode(next)) {
      writeText(localStore(), modeKey, next);
    }
  }, []);

  const setSplit = useCallback((fraction: number): void => {
    const clamped = Math.min(splitMax, Math.max(splitMin, fraction));
    setSplitState(clamped);
    writeText(localStore(), splitKey, String(clamped));
  }, []);

  const mode: LayoutMode = wide || chosen !== 'split' ? chosen : 'source';

  return { mode, chosen, choose, split, setSplit, wide };
}
