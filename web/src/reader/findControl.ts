import { createContext, useContext } from 'react';

export interface FindControl {
  open: (() => void) | undefined;
  register: (open: (() => void) | undefined) => void;
}

const FindControlContext = createContext<FindControl>({ open: undefined, register: () => undefined });

export const FindControlProvider = FindControlContext.Provider;

export function useFindControl(): FindControl {
  return useContext(FindControlContext);
}
