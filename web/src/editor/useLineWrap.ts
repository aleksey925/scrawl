import { useCallback, useState } from 'react';

import { localStore, readText, writeText } from '../storage';

import { wrapKey } from './constants';

export interface LineWrap {
  wrap: boolean;
  toggle: () => void;
}

export function useLineWrap(): LineWrap {
  const [wrap, setWrap] = useState(() => readText(localStore(), wrapKey) !== 'false');

  const toggle = useCallback((): void => {
    setWrap((was) => {
      writeText(localStore(), wrapKey, String(!was));
      return !was;
    });
  }, []);

  return { wrap, toggle };
}
