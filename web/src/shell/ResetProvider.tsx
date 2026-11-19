import { Button, Group } from '@mantine/core';
import {
  createContext, useCallback, useContext, useState,
  type JSX, type ReactNode,
} from 'react';

import { ResetDialog } from './dialogChunks';
import { useAccount } from './NavContext';

const ResetContext = createContext<(() => void) | undefined>(undefined);

export function ResetProvider({ children }: { children: ReactNode }): JSX.Element {
  const [opened, setOpened] = useState(false);
  const open = useCallback(() => setOpened(true), []);
  const close = useCallback(() => setOpened(false), []);

  return (
    <ResetContext.Provider value={open}>
      {children}
      {opened && (
        <ResetDialog onClose={close} />
      )}
    </ResetContext.Provider>
  );
}

export function ResetAction(): JSX.Element | null {
  const open = useContext(ResetContext);
  const { sync } = useAccount();
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
