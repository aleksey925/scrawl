import { createContext, useContext } from 'react';

export interface FindHandle {
  open: () => void;
  opened: boolean;
}

export interface FindControl {
  open: (() => void) | undefined;
  opened: boolean;
  register: (handle: FindHandle | undefined) => void;
}

const FindControlContext = createContext<FindControl>({ open: undefined, opened: false, register: () => undefined });

export const FindControlProvider = FindControlContext.Provider;

export function useFindControl(): FindControl {
  return useContext(FindControlContext);
}
