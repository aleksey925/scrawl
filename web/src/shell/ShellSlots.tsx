import { createContext, useContext, useEffect, useLayoutEffect, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ShellSlots {
  actionsSlot: HTMLElement | null;
  tocSlot: HTMLElement | null;
  barSlot: HTMLElement | null;
  footSlot: HTMLElement | null;
  barClaimed: boolean;
  claimBar: () => () => void;
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

export function PageActions({ children }: { children: ReactNode }): JSX.Element | null {
  const { actionsSlot } = useShellSlots();
  return actionsSlot === null ? null : createPortal(children, actionsSlot);
}

export function PageBar({ children }: { children: ReactNode }): JSX.Element | null {
  const { barSlot, claimBar } = useShellSlots();
  useLayoutEffect(claimBar, [claimBar]);
  return barSlot === null ? null : createPortal(children, barSlot);
}

export function PageFoot({ children }: { children: ReactNode }): JSX.Element | null {
  const { footSlot } = useShellSlots();
  return footSlot === null ? null : createPortal(children, footSlot);
}

export function usePageBarClaimed(): boolean {
  return useShellSlots().barClaimed;
}

export function PageToc({ children }: { children: ReactNode }): JSX.Element | null {
  const { tocSlot, setTocPresent } = useShellSlots();

  useEffect(() => {
    setTocPresent(true);
    return () => setTocPresent(false);
  }, [setTocPresent]);

  return tocSlot === null ? null : createPortal(children, tocSlot);
}
