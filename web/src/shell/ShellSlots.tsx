import { createContext, useContext, useEffect, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ShellSlots {
  actionsSlot: HTMLElement | null;
  tocSlot: HTMLElement | null;
  setTocPresent: (present: boolean) => void;
}

const ShellSlotsContext = createContext<ShellSlots | undefined>(undefined);

export const ShellSlotsProvider = ShellSlotsContext.Provider;

export function useShellSlots(): ShellSlots {
  const slots = useContext(ShellSlotsContext);
  if (slots === undefined) {
    throw new Error('shell slots are only available inside the app shell');
  }
  return slots;
}

// the slots are reached through refs the shell owns, never by element id: a
// note heading slugged "toc" would otherwise answer a lookup meant for chrome
export function PageActions({ children }: { children: ReactNode }): JSX.Element | null {
  const { actionsSlot } = useShellSlots();
  return actionsSlot === null ? null : createPortal(children, actionsSlot);
}

export function PageToc({ children }: { children: ReactNode }): JSX.Element | null {
  const { tocSlot, setTocPresent } = useShellSlots();

  useEffect(() => {
    setTocPresent(true);
    return () => setTocPresent(false);
  }, [setTocPresent]);

  return tocSlot === null ? null : createPortal(children, tocSlot);
}
