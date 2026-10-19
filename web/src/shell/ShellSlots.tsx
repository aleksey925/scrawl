import { createContext, useContext, useEffect, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ShellSlots {
  actionsSlot: HTMLElement | null;
  panelActionsSlot: HTMLElement | null;
  tocSlot: HTMLElement | null;
  setPanelActionsPresent: (present: boolean) => void;
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

// ActionPlace is where a page action is drawn: in the row of the topbar, or in
// the card of the panel beside the note, where each one is a whole button
export type ActionPlace = 'topbar' | 'panel';

const ActionPlaceContext = createContext<ActionPlace>('topbar');

export function useActionPlace(): ActionPlace {
  return useContext(ActionPlaceContext);
}

// the slots are reached through refs the shell owns, never by element id: a
// note heading slugged "toc" would otherwise answer a lookup meant for chrome
export function PageActions({ children }: { children: ReactNode }): JSX.Element | null {
  const { actionsSlot } = useShellSlots();
  return actionsSlot === null ? null : createPortal(children, actionsSlot);
}

export function PanelActions({ children }: { children: ReactNode }): JSX.Element | null {
  const { panelActionsSlot, setPanelActionsPresent } = useShellSlots();

  useEffect(() => {
    setPanelActionsPresent(true);
    return () => setPanelActionsPresent(false);
  }, [setPanelActionsPresent]);

  return panelActionsSlot === null
    ? null
    : createPortal(<ActionPlaceContext.Provider value="panel">{children}</ActionPlaceContext.Provider>, panelActionsSlot);
}

export function PageToc({ children }: { children: ReactNode }): JSX.Element | null {
  const { tocSlot, setTocPresent } = useShellSlots();

  useEffect(() => {
    setTocPresent(true);
    return () => setTocPresent(false);
  }, [setTocPresent]);

  return tocSlot === null ? null : createPortal(children, tocSlot);
}
