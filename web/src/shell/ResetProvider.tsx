import { Button, Group } from '@mantine/core';
import {
  createContext, Suspense, useCallback, useContext, useState,
  type JSX, type ReactNode,
} from 'react';

import { ResetDialog } from './dialogChunks';
import { useNav } from './NavContext';

const ResetContext = createContext<(() => void) | undefined>(undefined);

export function ResetProvider({ children }: { children: ReactNode }): JSX.Element {
  const [opened, setOpened] = useState(false);
  const open = useCallback(() => setOpened(true), []);
  const close = useCallback(() => setOpened(false), []);

  return (
    <ResetContext.Provider value={open}>
      {children}
      {opened && (
        <Suspense fallback={null}>
          <ResetDialog onClose={close} />
        </Suspense>
      )}
    </ResetContext.Provider>
  );
}

export function ResetAction(): JSX.Element | null {
  const open = useContext(ResetContext);
  const { sync } = useNav();
  if (open === undefined || sync?.canReset !== true) {
    return null;
  }
  return (
    <Group>
      <Button
        data-testid="sync-reset"
        size="xs"
        variant="default"
        onClick={open}
      >
        Replace local copy…
      </Button>
    </Group>
  );
}
