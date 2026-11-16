import { createContext, useContext, useEffect, useState, type JSX, type ReactNode } from 'react';

export type BarEdit = { kind: 'edit'; to: string } | { kind: 'disabled' };

const BarEditContext = createContext<BarEdit | undefined>(undefined);

const SetBarEditContext = createContext<((edit: BarEdit | undefined) => void) | undefined>(undefined);

export function BarEditProvider({ children }: { children: ReactNode }): JSX.Element {
  const [edit, setEdit] = useState<BarEdit | undefined>(undefined);
  return (
    <SetBarEditContext.Provider value={setEdit}>
      <BarEditContext.Provider value={edit}>{children}</BarEditContext.Provider>
    </SetBarEditContext.Provider>
  );
}

export function useBarEdit(): BarEdit | undefined {
  return useContext(BarEditContext);
}

export function useOfferEdit(to: string | undefined): void {
  const setEdit = useContext(SetBarEditContext);
  if (setEdit === undefined) {
    throw new Error('the bar edit is only available inside the app shell');
  }
  useEffect(() => {
    setEdit(to === undefined ? { kind: 'disabled' } : { kind: 'edit', to });
    return () => setEdit(undefined);
  }, [setEdit, to]);
}
