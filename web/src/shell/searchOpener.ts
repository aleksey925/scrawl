import { createContext, useContext } from 'react';

export interface SearchControl {
  opened: boolean;
  open: (text?: string) => void;
  close: () => void;
}

const SearchControlContext = createContext<SearchControl | undefined>(undefined);

export const SearchControlProvider = SearchControlContext.Provider;

export function useSearchControl(): SearchControl | undefined {
  return useContext(SearchControlContext);
}
