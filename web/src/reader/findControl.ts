import { createContext, useContext } from 'react';

// FindControl opens the find bar of the note on screen from outside the note,
// the way the note's menu does on a phone. The note registers how to open its
// bar while it is mounted.
export interface FindControl {
  open: (() => void) | undefined;
  register: (open: (() => void) | undefined) => void;
}

const FindControlContext = createContext<FindControl>({ open: undefined, register: () => undefined });

export const FindControlProvider = FindControlContext.Provider;

export function useFindControl(): FindControl {
  return useContext(FindControlContext);
}
