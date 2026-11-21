import {
  useCallback, useEffect, useMemo, useState,
  type JSX, type ReactNode,
} from 'react';

import { useReadingCopy } from '../offline/connection';
import { layoutBreakpoints, useBelow } from '../theme';

import { SearchDialog } from './dialogChunks';
import { SearchControlProvider, type SearchControl } from './searchOpener';
import { appShortcut, modChord } from './shortcuts';

export function SearchProvider({ children }: { children: ReactNode }): JSX.Element {
  const offline = useReadingCopy();
  const phone = useBelow(layoutBreakpoints.phone);
  const enabled = !offline || phone;
  const [opened, setOpened] = useState(false);
  const [initial, setInitial] = useState('');

  const open = useCallback((text?: string) => {
    setInitial(text ?? '');
    setOpened(true);
  }, []);
  const close = useCallback(() => setOpened(false), []);
  const control = useMemo<SearchControl>(() => ({ opened, open, close }), [opened, open, close]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!modChord(event, 'k') || !appShortcut(event)) {
        return;
      }
      event.preventDefault();
      open();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, enabled]);

  return (
    <SearchControlProvider value={enabled ? control : undefined}>
      {children}
      {enabled && opened && (
        <SearchDialog initial={initial} offline={offline} onClose={close} />
      )}
    </SearchControlProvider>
  );
}
